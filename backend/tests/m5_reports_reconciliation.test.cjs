const assert = require('node:assert/strict');
const test = require('node:test');
const { isolatedDatabase } = require('./helpers/isolatedDatabase.cjs');
const { checkInRoomLine } = require('../src/services/checkInService');
const { voidServiceUsage } = require('../src/services/serviceUsageService');
const { buildReportQuery } = require('../src/reportQueries');

test('report totals count rooms, invoice lines, usage, payments and refunds once across a two-room stay', async () => {
  const fixture = await isolatedDatabase();
  const { client, schema } = fixture;
  try {
    const branch = (await client.query('SELECT branch_id FROM branch ORDER BY branch_id LIMIT 1')).rows[0].branch_id;
    async function officer(username, role) {
      const id = (await client.query('INSERT INTO user_account(username) VALUES ($1) RETURNING user_id',[username])).rows[0].user_id;
      await client.query('INSERT INTO officer(officer_id,full_name,branch_id,role_id) SELECT $1,$2,$3,role_id FROM role WHERE role_name=$4',[id,username,branch,role]);
      return id;
    }
    const staff = await officer('reconcile.desk','FRONT_DESK');
    const manager = await officer('reconcile.chain','CHAIN_MANAGER');
    const guest = (await client.query("INSERT INTO guest(full_name) VALUES ('Reconciliation guest') RETURNING guest_id")).rows[0].guest_id;
    const policy = (await client.query(`INSERT INTO billing_policy(effective_from,tax_percent,service_charge_percent,max_discount_percent,cancellation_fee,no_show_fee,late_checkout_fee,no_show_grace_days,is_demo,created_by)
      VALUES ('2020-01-01',0,0,20,0,0,0,1,false,$1) RETURNING billing_policy_id`,[manager])).rows[0].billing_policy_id;
    const type = (await client.query("INSERT INTO room_type(name,capacity,base_daily_rate) VALUES ('Reconciliation',2,100) RETURNING room_type_id")).rows[0].room_type_id;
    const rooms = [];
    for (const number of ['QA-1','QA-2']) rooms.push((await client.query('INSERT INTO room(branch_id,room_type_id,room_number) VALUES ($1,$2,$3) RETURNING room_id',[branch,type,number])).rows[0].room_id);
    const dates = (await client.query("SELECT ((now() AT TIME ZONE 'Asia/Colombo')::date)::text AS start, ((now() AT TIME ZONE 'Asia/Colombo')::date + 2)::text AS finish, ((now() AT TIME ZONE 'Asia/Colombo')::date + 4)::text AS future_start, ((now() AT TIME ZONE 'Asia/Colombo')::date + 6)::text AS future_finish")).rows[0];
    async function booking(selected, start, finish) {
      const selections = selected.map(roomId => ({roomId,checkIn:start,checkOut:finish,guestCount:1,quotedRoomTypeId:type,quotedBaseDailyRate:'100.00'}));
      const row = (await client.query('SELECT * FROM sp_create_booking($1,$2,$3,$4,$5,$6::jsonb)',[guest,'FRONT_DESK',staff,branch,policy,JSON.stringify(selections)])).rows[0];
      const lines = (await client.query('SELECT line_id FROM booking_room_line WHERE booking_id=$1 ORDER BY line_id',[row.booking_id])).rows;
      return {...row,lines};
    }
    const current = await booking(rooms,dates.start,dates.finish);
    await booking([rooms[0]],dates.future_start,dates.future_finish);
    const occupancy = async () => (await client.query('SELECT * FROM view_current_occupancy WHERE branch_id=$1',[branch])).rows[0];
    assert.equal(Number((await occupancy()).total_rooms),2,'future reservations do not multiply inventory');
    assert.equal(Number((await occupancy()).occupied_rooms),0,'BOOKED is not occupied');
    await checkInRoomLine(client,{lineId:current.lines[0].line_id,actorId:staff,schema});
    assert.equal(Number((await occupancy()).occupied_rooms),1);
    await checkInRoomLine(client,{lineId:current.lines[1].line_id,actorId:staff,schema});
    assert.equal(Number((await occupancy()).occupancy_rate_percentage),100);
    const service = (await client.query("INSERT INTO service(name,category,current_price) VALUES ('Tea, QA','Food',25) RETURNING service_id")).rows[0].service_id;
    const usages = [];
    for (let index=0; index<2; index++) usages.push((await client.query('INSERT INTO service_usage(booking_id,service_id,quantity,unit_price_snapshot,recorded_by) VALUES ($1,$2,2,25,$3) RETURNING usage_id',[current.booking_id,service,staff])).rows[0].usage_id);
    await client.query('UPDATE service SET current_price=75 WHERE service_id=$1',[service]);
    await client.query('SELECT fn_refresh_draft_invoice($1,$2)',[current.booking_id,staff]);
    await client.query("INSERT INTO invoice_line(invoice_id,line_type,description,amount) VALUES ($1,'PRICE_ADJUSTMENT','Approved signed correction',-10)",[current.invoice_id]);
    await client.query("SELECT fn_record_payment($1,$2,'PAYMENT',490,'CASH','QA-PAY','SUCCESSFUL')",[current.booking_id,staff]);
    await voidServiceUsage(client,{bookingId:current.booking_id,usageId:usages[1],voidedBy:manager,reason:'Duplicate charge'});
    await client.query("SELECT fn_record_payment($1,$2,'REFUND',50,'CASH','QA-REFUND','SUCCESSFUL')",[current.booking_id,staff]);
    await client.query("INSERT INTO payment(booking_id,recorded_by,kind,amount,method,status,reference) VALUES ($1,$2,'PAYMENT',900,'CASH','FAILED','QA-FAILED')",[current.booking_id,staff]);
    const bill = (await client.query('SELECT * FROM v_report_billing_summary WHERE booking_id=$1',[current.booking_id])).rows[0];
    assert.equal(Number(bill.total_amount),440);
    assert.equal(Number(bill.paid_amount),490);
    assert.equal(Number(bill.refunded_amount),50);
    assert.equal(Number(bill.net_paid),440);
    assert.equal(Number(bill.balance),0);
    const history = (await client.query('SELECT * FROM view_guest_history WHERE guest_id=$1',[guest])).rows[0];
    assert.equal(Number(history.lifetime_expenditure),490,'gross successful payments retain existing history contract');
    assert.equal(Number(history.total_stays),2);
    const usage = (await client.query('SELECT * FROM view_service_usage WHERE service_id=$1',[service])).rows[0];
    assert.equal(Number(usage.total_orders),1);
    assert.equal(Number(usage.total_quantity_consumed),2);
    assert.equal(Number(usage.total_revenue_generated),50,'snapshot and void survive catalogue change');
    assert.deepEqual((await client.query('SELECT * FROM view_monthly_branch_revenue')).rows,[],'DRAFT and cash are excluded');
    for (const line of current.lines) await client.query('SELECT * FROM fn_checkout_room_line($1,$2,$3)',[current.booking_id,line.line_id,staff]);
    const revenue = (await client.query('SELECT * FROM view_monthly_branch_revenue WHERE branch_id=$1',[branch])).rows[0];
    assert.equal(Number(revenue.total_revenue_lkr),440);
    assert.equal(Number(revenue.room_revenue_lkr),400);
    assert.equal(Number(revenue.service_revenue_lkr),50);
    assert.equal(Number(revenue.other_revenue_lkr),-10);
    const month = (await client.query("SELECT to_char(now() AT TIME ZONE 'Asia/Colombo','YYYY-MM') AS month, to_char($1::timestamptz AT TIME ZONE 'Asia/Colombo','YYYY-MM') AS actual",[revenue.revenue_month])).rows[0];
    assert.equal(month.actual,month.month);
    assert.equal(Number((await occupancy()).occupied_rooms),0);
    for (const name of ['occupancy','billing','revenue','guest-history','service-usage','trends','audit-logs']) {
      const query = buildReportQuery(name,{branch_id:branch});
      assert.ok(Array.isArray((await client.query(query.sql,query.values)).rows),name);
    }
  } finally { await fixture.close(); }
});
