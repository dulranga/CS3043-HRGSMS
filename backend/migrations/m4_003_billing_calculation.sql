-- M4-S04: Deterministic billing calculations and functions
-- SRS §4.7.4 (Calculation order and policy rules), Table 45 (fn_billable_nights, fn_room_charge, fn_service_total)

-- Function: fn_billable_nights
-- Return reserved stay_end_date - stay_start_date nights; early departure does not reduce them.
CREATE OR REPLACE FUNCTION fn_billable_nights(p_stay_start_date date, p_stay_end_date date)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_stay_end_date <= p_stay_start_date THEN
        RAISE EXCEPTION 'stay_end_date (%) must be greater than stay_start_date (%)', p_stay_end_date, p_stay_start_date
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN (p_stay_end_date - p_stay_start_date);
END;
$$;

-- Function: fn_room_charge
-- Sum BOOKED/CHECKED_IN/CHECKED_OUT line snapshots * reserved nights; exclude CANCELLED/NO_SHOW.
CREATE OR REPLACE FUNCTION fn_room_charge(p_booking_id uuid)
RETURNS numeric(14, 2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_total numeric(14, 2);
BEGIN
    SELECT COALESCE(SUM(ROUND(rate_snapshot * (stay_end_date - stay_start_date), 2)), 0.00)
      INTO v_total
      FROM booking_room_line
     WHERE booking_id = p_booking_id
       AND status IN ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT');
    RETURN v_total;
END;
$$;

-- Function: fn_service_total
-- Return sum of valid (non-void) service usage charges.
CREATE OR REPLACE FUNCTION fn_service_total(p_booking_id uuid)
RETURNS numeric(14, 2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_total numeric(14, 2);
BEGIN
    SELECT COALESCE(SUM(ROUND(quantity * unit_price_snapshot, 2)), 0.00)
      INTO v_total
      FROM service_usage
     WHERE booking_id = p_booking_id
       AND voided IS FALSE;
    RETURN v_total;
END;
$$;

-- Function: fn_calculate_booking_invoice_lines
-- Deterministically computes invoice lines in SRS §4.7.4 order using ONLY the invoice's linked billing_policy version.
CREATE OR REPLACE FUNCTION fn_calculate_booking_invoice_lines(
    p_booking_id uuid,
    p_approved_discount numeric DEFAULT 0.00
)
RETURNS TABLE (
    line_type invoice_line_type_enum,
    booking_room_line_id uuid,
    description varchar(255),
    amount numeric(14, 2),
    sort_order integer
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_policy_id uuid;
    v_policy record;
    v_gross numeric(14, 2) := 0.00;
    v_discount numeric(14, 2) := 0.00;
    v_max_discount numeric(14, 2) := 0.00;
    v_base_after_discount numeric(14, 2) := 0.00;
    v_service_charge numeric(14, 2) := 0.00;
    v_tax numeric(14, 2) := 0.00;
    r_line record;
    r_usage record;
    v_nights integer;
    v_line_amount numeric(14, 2);
BEGIN
    -- 1. Fetch invoice to retrieve its immutable linked billing_policy_id
    SELECT billing_policy_id INTO v_policy_id
      FROM invoice
     WHERE booking_id = p_booking_id;

    IF v_policy_id IS NULL THEN
        RAISE EXCEPTION 'No invoice found for booking %', p_booking_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- 2. Fetch linked policy version attributes
    SELECT * INTO v_policy
      FROM billing_policy
     WHERE billing_policy_id = v_policy_id;

    IF v_policy IS NULL THEN
        RAISE EXCEPTION 'Linked billing policy % not found', v_policy_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- 3. Room Charges and Flat Fees
    FOR r_line IN
        SELECT line_id, stay_start_date, stay_end_date, rate_snapshot, status
          FROM booking_room_line
         WHERE booking_id = p_booking_id
         ORDER BY stay_start_date, line_id
    LOOP
        v_nights := fn_billable_nights(r_line.stay_start_date, r_line.stay_end_date);
        IF r_line.status IN ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT') THEN
            v_line_amount := ROUND(r_line.rate_snapshot * v_nights, 2);
            v_gross := v_gross + v_line_amount;
            line_type := 'ROOM'::invoice_line_type_enum;
            booking_room_line_id := r_line.line_id;
            description := 'Room charge (' || v_nights || ' nights @ ' || to_char(r_line.rate_snapshot, 'FM999999990.00') || ')';
            amount := v_line_amount;
            sort_order := 10;
            RETURN NEXT;
        ELSIF r_line.status = 'CANCELLED' THEN
            -- No room-night charge; add flat cancellation fee
            IF v_policy.cancellation_fee > 0 THEN
                line_type := 'CANCELLATION_FEE'::invoice_line_type_enum;
                booking_room_line_id := r_line.line_id;
                description := 'Cancellation fee';
                amount := ROUND(v_policy.cancellation_fee, 2);
                sort_order := 60;
                RETURN NEXT;
            END IF;
        ELSIF r_line.status = 'NO_SHOW' THEN
            -- No room-night charge; add flat no-show fee
            IF v_policy.no_show_fee > 0 THEN
                line_type := 'NO_SHOW_FEE'::invoice_line_type_enum;
                booking_room_line_id := r_line.line_id;
                description := 'No-show fee';
                amount := ROUND(v_policy.no_show_fee, 2);
                sort_order := 70;
                RETURN NEXT;
            END IF;
        END IF;
    END LOOP;

    -- 4. Non-void service usages (each usage charge rounded to two decimals)
    FOR r_usage IN
        SELECT su.usage_id, su.booking_room_line_id, su.quantity, su.unit_price_snapshot, s.name AS service_name
          FROM service_usage su
          JOIN service s ON s.service_id = su.service_id
         WHERE su.booking_id = p_booking_id
           AND su.voided IS FALSE
         ORDER BY su.used_at, su.usage_id
    LOOP
        v_line_amount := ROUND(r_usage.quantity * r_usage.unit_price_snapshot, 2);
        v_gross := v_gross + v_line_amount;
        line_type := 'SERVICE'::invoice_line_type_enum;
        booking_room_line_id := r_usage.booking_room_line_id;
        description := 'Service: ' || r_usage.service_name || ' (' || r_usage.quantity || ' @ ' || to_char(r_usage.unit_price_snapshot, 'FM999999990.00') || ')';
        amount := v_line_amount;
        sort_order := 20;
        RETURN NEXT;
    END LOOP;

    -- 5. Approved Discount D (never greater than G, and <= max_discount_percent of G)
    IF p_approved_discount IS NOT NULL AND p_approved_discount > 0 THEN
        v_max_discount := ROUND(v_gross * (v_policy.max_discount_percent / 100.0), 2);
        v_discount := LEAST(p_approved_discount, v_max_discount, v_gross);
        IF v_discount > 0 THEN
            line_type := 'DISCOUNT'::invoice_line_type_enum;
            booking_room_line_id := NULL;
            description := 'Approved discount';
            amount := -v_discount; -- Stored as negative amount per SRS §4.7.4
            sort_order := 30;
            RETURN NEXT;
        END IF;
    END IF;

    v_base_after_discount := v_gross - v_discount;

    -- 6. Percentage Service Charge on (G - D)
    IF v_policy.service_charge_percent > 0 AND v_base_after_discount > 0 THEN
        v_service_charge := ROUND(v_base_after_discount * (v_policy.service_charge_percent / 100.0), 2);
        IF v_service_charge > 0 THEN
            line_type := 'PERCENT_SERVICE_CHARGE'::invoice_line_type_enum;
            booking_room_line_id := NULL;
            description := 'Service charge (' || v_policy.service_charge_percent || '%)';
            amount := v_service_charge;
            sort_order := 40;
            RETURN NEXT;
        END IF;
    END IF;

    -- 7. Tax on (G - D + service_charge)
    IF v_policy.tax_percent > 0 AND (v_base_after_discount + v_service_charge) > 0 THEN
        v_tax := ROUND((v_base_after_discount + v_service_charge) * (v_policy.tax_percent / 100.0), 2);
        IF v_tax > 0 THEN
            line_type := 'TAX'::invoice_line_type_enum;
            booking_room_line_id := NULL;
            description := 'Tax (' || v_policy.tax_percent || '%)';
            amount := v_tax;
            sort_order := 50;
            RETURN NEXT;
        END IF;
    END IF;

    RETURN;
END;
$$;
