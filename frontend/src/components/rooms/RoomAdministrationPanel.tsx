import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormField } from '@/components/ui/form-field';
import { formatLkr } from '@/lib/money';
import { Amenity, AmenityDraft, AffectedLine, BlockDraft, Condition, CONDITIONS, Room, RoomAdminApi, RoomAdminError, RoomAdminSession, RoomBlock, RoomDraft, RoomType, TypeDraft, conflictAdvice, permissions } from '@/lib/roomAdministration';

export interface AdministrationData { types: RoomType[]; amenities: Amenity[]; rooms: Room[] }
export type AdministrationClient = Pick<RoomAdminApi, 'types' | 'amenities' | 'rooms' | 'detail' | 'blocks' | 'saveType' | 'toggleType' | 'saveAmenity' | 'toggleAmenity' | 'saveRoom' | 'toggleRoom' | 'saveBlock' | 'removeBlock' | 'changeCondition'>;
const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
function Field({ label, value, onChange, disabled = false, type = 'text', maxLength = 255 }: { label: string; value: string; onChange(value: string): void; disabled?: boolean; type?: string; maxLength?: number }) {
  const id = useId();
  return <div className="min-w-0 space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} type={type} maxLength={maxLength} /></div>;
}
export function Reservations({ lines }: { lines: AffectedLine[] }) {
  if (!lines.length) return null;
  return <div className="space-y-2"><p className="text-sm font-semibold">Affected reservations</p>{lines.map(line => <Card key={line.lineId} className="shadow-none"><CardContent className="space-y-1 p-3"><p className="break-all font-medium">{line.bookingRef}</p><p className="text-sm">{line.status} · {line.stayStartDate} to {line.stayEndDate} · {line.guestCount} guests</p><p className="break-all text-xs text-muted-foreground">Room line: {line.lineId}</p></CardContent></Card>)}</div>;
}

interface PanelProps { session: RoomAdminSession | null; api: AdministrationClient; initialData?: AdministrationData }
export function RoomAdministrationPanel(props: PanelProps) {
  // Discard drafts and selected branch details when verified access changes.
  return <RoomAdministrationContent key={`${props.session?.role}:${props.session?.branchId}`} {...props} />;
}
function RoomAdministrationContent({ session, api, initialData }: PanelProps) {
  const access = permissions(session);
  const [data, setData] = useState<AdministrationData>(initialData ?? { types: [], amenities: [], rooms: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RoomAdminError | null>(null);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'types' | 'amenities' | 'rooms'>(access.branchRead ? 'rooms' : 'types');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [typeEditor, setTypeEditor] = useState<{ id?: string; draft: TypeDraft } | null>(null);
  const [amenityEditor, setAmenityEditor] = useState<{ id?: string; draft: AmenityDraft } | null>(null);
  const [roomEditor, setRoomEditor] = useState<{ room?: Room; draft: RoomDraft } | null>(null);
  const [selected, setSelected] = useState<Room | null>(null);
  const [blocks, setBlocks] = useState<RoomBlock[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [blockEditor, setBlockEditor] = useState<{ block?: RoomBlock; draft: BlockDraft } | null>(null);
  const [removing, setRemoving] = useState<RoomBlock | null>(null);
  const [condition, setCondition] = useState<Condition>('READY');
  const [reason, setReason] = useState('');
  const canUse = !!session;
  const disabled = busy || loading || !canUse;

  const reload = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const [types, amenities, rooms] = await Promise.all([api.types(), api.amenities(), permissions(session).branchRead ? api.rooms() : Promise.resolve([])]);
      // Defense in depth: never render a cross-branch inventory record even if
      // a faulty API adapter returns one. Server authorization remains required.
      setData({ types, amenities, rooms: rooms.filter(room => room.branchId.toLowerCase() === session.branchId?.toLowerCase()) });
    } finally { setLoading(false); }
  }, [api, session]);

  useEffect(() => {
    if (initialData || !session) return;
    let current = true;
    setLoading(true);
    Promise.all([api.types(), api.amenities(), permissions(session).branchRead ? api.rooms() : Promise.resolve([])])
      .then(([types, amenities, rooms]) => { if (current) setData({ types, amenities, rooms: rooms.filter(room => room.branchId.toLowerCase() === session.branchId?.toLowerCase()) }); })
      .catch(error => { if (current) setFailure(error instanceof RoomAdminError ? error : new RoomAdminError('Unable to load room administration.', 0)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, session, initialData]);

  useEffect(() => {
    if (!selected) return;
    let current = true;
    setDetailsLoading(true);
    Promise.all([api.detail(selected), api.blocks(selected)])
      .then(([room, values]) => { if (current) { setSelected(room); setBlocks(values); } })
      .catch(error => { if (current) setFailure(error instanceof RoomAdminError ? error : new RoomAdminError('Unable to load room details.', 0)); })
      .finally(() => { if (current) setDetailsLoading(false); });
    return () => { current = false; };
    // Reload on room selection only; replacing the fetched DTO must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, selected?.roomId]);

  async function mutate(work: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setFailure(null); setNotice('');
    try { await work(); }
    catch (error) { setFailure(error instanceof RoomAdminError ? error : new RoomAdminError('Unable to save changes.', 0)); setBusy(false); return false; }
    setNotice('Changes saved.');
    try {
      await reload();
      if (selected) { const [room, values] = await Promise.all([api.detail(selected), api.blocks(selected)]); setSelected(room); setBlocks(values); }
    } catch { setFailure(new RoomAdminError('Changes were saved, but the refreshed records could not be loaded. Reload before making another change.', 0, 'REFRESH_FAILED')); }
    setBusy(false); return true;
  }
  function visible(record: { active: boolean }, name: string) {
    return (activeFilter === 'all' || record.active === (activeFilter === 'active')) && name.toLowerCase().includes(search.toLowerCase().trim());
  }
  const visibleRooms = data.rooms.filter(room => room.branchId.toLowerCase() === session?.branchId?.toLowerCase() && visible(room, `${room.roomNumber} ${room.roomType.name}`));
  const advice = failure ? conflictAdvice(failure) : null;
  const catalogueEditable = access.catalogue && !disabled;
  const inventoryEditable = access.inventory && !disabled;
  const sessionDescription = useMemo(() => !session ? 'Sign in with a staff account to access room administration.' : session.role === 'CHAIN_MANAGER' ? 'Chain-wide room types and amenities. Room prices apply to new confirmations.' : access.branchRead ? 'Rooms and dated blocks are restricted to your assigned branch.' : 'Catalogue access is read-only for your role.', [session, access.branchRead]);

  return <div className="space-y-6 @container">
    <header className="space-y-2"><h1 className="text-2xl font-bold tracking-tight">Room administration</h1><p className="text-sm text-muted-foreground">{sessionDescription}</p></header>
    {!session && <Card><CardContent className="p-4"><p role="status">Sign in to load room records. Room administration is unavailable until staff sign-in is connected.</p></CardContent></Card>}
    {failure && <Card className="border-destructive"><CardContent className="space-y-3 p-4"><p role="alert" className="text-destructive">{failure.message}</p>{advice && <p className="text-sm">{advice}</p>}<Reservations lines={failure.affectedLines} /></CardContent></Card>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap gap-2" aria-label="Administration sections">{(['types', 'amenities', ...(access.branchRead ? ['rooms'] : [])] as const).map(value => <Button key={value} variant={tab === value ? 'default' : 'outline'} aria-pressed={tab === value} onClick={() => { setTab(value as typeof tab); setSearch(''); }} disabled={busy}>{value === 'types' ? 'Room types' : value === 'amenities' ? 'Amenities' : 'Branch rooms & blocks'}</Button>)}</div>
    <Card><CardContent className="flex flex-wrap items-end gap-4 p-4"><Field label="Search records" value={search} onChange={setSearch} disabled={!canUse} /><div className="space-y-2"><p className="text-sm">Record status</p><div className="flex flex-wrap gap-2">{(['all', 'active', 'inactive'] as const).map(value => <Button size="sm" key={value} variant={activeFilter === value ? 'default' : 'outline'} aria-pressed={activeFilter === value} onClick={() => setActiveFilter(value)}>{value}</Button>)}</div></div><Button variant="outline" disabled={disabled} onClick={() => { setFailure(null); void reload().catch(error => setFailure(error instanceof RoomAdminError ? error : new RoomAdminError('Unable to load room administration.', 0))); }}>{loading ? 'Loading…' : 'Reload records'}</Button></CardContent></Card>

    {tab === 'types' && <section className="space-y-4" aria-label="Room types"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">Room types</h2><Button disabled={!catalogueEditable} onClick={() => setTypeEditor({ draft: { name: '', capacity: '', baseDailyRate: '', amenityIds: [] } })}>Add room type</Button></div><p className="text-sm text-muted-foreground">Only Chain Managers can change names, capacities, rates, amenities and active status. Existing booking rate snapshots stay fixed.</p>
      {typeEditor && <Card><CardHeader><CardTitle>{typeEditor.id ? 'Edit room type' : 'New room type'}</CardTitle></CardHeader><CardContent><FormField className="space-y-4" onSubmit={event => { event.preventDefault(); void mutate(() => api.saveType(typeEditor.draft, typeEditor.id)).then(saved => { if (saved) setTypeEditor(null); }); }}>
        <div className={GRID}><Field label="Type name" value={typeEditor.draft.name} disabled={!catalogueEditable} onChange={name => setTypeEditor({ ...typeEditor, draft: { ...typeEditor.draft, name } })} /><Field label="Capacity" value={typeEditor.draft.capacity} type="number" disabled={!catalogueEditable} onChange={capacity => setTypeEditor({ ...typeEditor, draft: { ...typeEditor.draft, capacity } })} /><Field label="Base daily rate (LKR)" value={typeEditor.draft.baseDailyRate} disabled={!catalogueEditable} onChange={baseDailyRate => setTypeEditor({ ...typeEditor, draft: { ...typeEditor.draft, baseDailyRate } })} /></div>
        <p className="text-sm font-medium">Amenities</p><div className="flex flex-wrap gap-2">{data.amenities.filter(item => item.active || typeEditor.draft.amenityIds.includes(item.amenityId)).map(item => <Button type="button" key={item.amenityId} variant={typeEditor.draft.amenityIds.includes(item.amenityId) ? 'default' : 'outline'} aria-pressed={typeEditor.draft.amenityIds.includes(item.amenityId)} disabled={!catalogueEditable} onClick={() => setTypeEditor({ ...typeEditor, draft: { ...typeEditor.draft, amenityIds: typeEditor.draft.amenityIds.includes(item.amenityId) ? typeEditor.draft.amenityIds.filter(id => id !== item.amenityId) : [...typeEditor.draft.amenityIds, item.amenityId] } })}>{item.name}{!item.active ? ' (inactive — remove before saving)' : ''}</Button>)}</div><div className="flex gap-2"><Button type="submit" disabled={!catalogueEditable}>Save room type</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setTypeEditor(null)}>Cancel</Button></div>
      </FormField></CardContent></Card>}
      <div className={GRID}>{data.types.filter(type => visible(type, type.name)).map(type => <Card key={type.roomTypeId}><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="break-words text-lg">{type.name}</CardTitle><Badge variant={type.active ? 'default' : 'secondary'}>{type.active ? 'Active' : 'Inactive'}</Badge></div></CardHeader><CardContent className="space-y-3"><p>{type.capacity} guests · {formatLkr(type.baseDailyRate)} / night</p><p className="text-sm text-muted-foreground">{type.amenities.map(item => item.name).join(', ') || 'No amenities assigned'}</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={!catalogueEditable} onClick={() => setTypeEditor({ id: type.roomTypeId, draft: { name: type.name, capacity: String(type.capacity), baseDailyRate: type.baseDailyRate, amenityIds: type.amenities.map(item => item.amenityId) } })}>Edit room type</Button><Button size="sm" variant="outline" disabled={!catalogueEditable} onClick={() => void mutate(() => api.toggleType(type))}>{type.active ? 'Deactivate type' : 'Activate type'}</Button></div></CardContent></Card>)}</div>{!loading && !data.types.some(type => visible(type, type.name)) && <p className="text-sm text-muted-foreground">No matching room types.</p>}
    </section>}

    {tab === 'amenities' && <section className="space-y-4" aria-label="Amenities"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">Amenities</h2><Button disabled={!catalogueEditable} onClick={() => setAmenityEditor({ draft: { name: '', description: '' } })}>Add amenity</Button></div>
      {amenityEditor && <Card><CardHeader><CardTitle>{amenityEditor.id ? 'Edit amenity' : 'New amenity'}</CardTitle></CardHeader><CardContent><FormField className="space-y-4" onSubmit={event => { event.preventDefault(); void mutate(() => api.saveAmenity(amenityEditor.draft, amenityEditor.id)).then(saved => { if (saved) setAmenityEditor(null); }); }}><Field label="Amenity name" value={amenityEditor.draft.name} disabled={!catalogueEditable} onChange={name => setAmenityEditor({ ...amenityEditor, draft: { ...amenityEditor.draft, name } })} /><Field label="Description (optional)" value={amenityEditor.draft.description} maxLength={255} disabled={!catalogueEditable} onChange={description => setAmenityEditor({ ...amenityEditor, draft: { ...amenityEditor.draft, description } })} /><div className="flex gap-2"><Button type="submit" disabled={!catalogueEditable}>Save amenity</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setAmenityEditor(null)}>Cancel</Button></div></FormField></CardContent></Card>}
      <div className={GRID}>{data.amenities.filter(item => visible(item, item.name)).map(item => <Card key={item.amenityId}><CardHeader><CardTitle className="break-words text-lg">{item.name}</CardTitle></CardHeader><CardContent className="space-y-3"><Badge variant={item.active ? 'default' : 'secondary'}>{item.active ? 'Active' : 'Inactive'}</Badge><p className="break-words text-sm">{item.description || 'No description'}</p><div className="flex flex-wrap gap-2"><Button disabled={!catalogueEditable} size="sm" onClick={() => setAmenityEditor({ id: item.amenityId, draft: { name: item.name, description: item.description ?? '' } })}>Edit amenity</Button><Button disabled={!catalogueEditable} size="sm" variant="outline" onClick={() => void mutate(() => api.toggleAmenity(item))}>{item.active ? 'Deactivate amenity' : 'Activate amenity'}</Button></div></CardContent></Card>)}</div>{!loading && !data.amenities.some(item => visible(item, item.name)) && <p className="text-sm text-muted-foreground">No matching amenities.</p>}
    </section>}

    {tab === 'rooms' && <section className="space-y-4" aria-label="Branch rooms"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">Branch rooms & blocks</h2><Button disabled={!inventoryEditable} onClick={() => setRoomEditor({ draft: { roomNumber: '', roomTypeId: '' } })}>Add room</Button></div><p className="text-sm text-muted-foreground">Branch Managers edit rooms and blocks. Branch Managers and Service Staff record physical condition. READY describes condition; reservations and occupancy are separate.</p>
      {roomEditor && <Card><CardHeader><CardTitle>{roomEditor.room ? 'Edit room' : 'New room'}</CardTitle></CardHeader><CardContent><FormField className="space-y-4" onSubmit={event => { event.preventDefault(); void mutate(() => api.saveRoom(roomEditor.draft, roomEditor.room)).then(saved => { if (saved) setRoomEditor(null); }); }}><Field label="Room number" value={roomEditor.draft.roomNumber} disabled={!inventoryEditable} onChange={roomNumber => setRoomEditor({ ...roomEditor, draft: { ...roomEditor.draft, roomNumber } })} /><p className="text-sm font-medium">Room type</p><div className="flex flex-wrap gap-2">{data.types.filter(type => type.active || type.roomTypeId === roomEditor.draft.roomTypeId).map(type => <Button type="button" key={type.roomTypeId} aria-pressed={type.roomTypeId === roomEditor.draft.roomTypeId} variant={type.roomTypeId === roomEditor.draft.roomTypeId ? 'default' : 'outline'} disabled={!inventoryEditable || !type.active} onClick={() => setRoomEditor({ ...roomEditor, draft: { ...roomEditor.draft, roomTypeId: type.roomTypeId } })}>{type.name} · {type.capacity} guests</Button>)}</div><div className="flex gap-2"><Button type="submit" disabled={!inventoryEditable}>Save room</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setRoomEditor(null)}>Cancel</Button></div></FormField></CardContent></Card>}
      <div className={GRID}>{visibleRooms.map(room => <Card key={room.roomId}><CardHeader><CardTitle>Room {room.roomNumber}</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2"><Badge>{room.operationalStatus}</Badge><Badge variant="secondary">{room.active ? 'Active' : 'Inactive'}</Badge></div><p className="text-sm">{room.roomType.name} · {room.roomType.capacity} guests</p><p className="text-xs text-muted-foreground">{room.activeAssignmentCount} active reservations · {room.blockCount} dated blocks</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled} onClick={() => { setSelected(room); setBlocks([]); setBlockEditor(null); setRemoving(null); setCondition(room.operationalStatus); setReason(''); }}>View room & blocks</Button><Button size="sm" disabled={!inventoryEditable} onClick={() => setRoomEditor({ room, draft: { roomNumber: room.roomNumber, roomTypeId: room.roomType.roomTypeId } })}>Edit room</Button><Button size="sm" variant="outline" disabled={!inventoryEditable} onClick={() => void mutate(() => api.toggleRoom(room))}>{room.active ? 'Deactivate room' : 'Activate room'}</Button></div></CardContent></Card>)}</div>{!loading && !visibleRooms.length && <p className="text-sm text-muted-foreground">No matching rooms in your branch.</p>}
      {selected && <Card><CardHeader><CardTitle>Room {selected.roomNumber}</CardTitle></CardHeader><CardContent className="space-y-4">{detailsLoading ? <p role="status">Loading room history…</p> : <>
        <Reservations lines={selected.affectedLines ?? []} />
        <div className="space-y-3"><h3 className="font-semibold">Physical condition</h3><div className="flex flex-wrap gap-2">{CONDITIONS.map(value => <Button key={value} aria-pressed={condition === value} variant={condition === value ? 'default' : 'outline'} disabled={!access.condition || disabled} onClick={() => setCondition(value)}>{value}</Button>)}</div><Field label="Condition change reason" value={reason} disabled={!access.condition || disabled} onChange={setReason} /><Button disabled={!access.condition || disabled} onClick={() => void mutate(() => api.changeCondition(selected, condition, reason)).then(saved => { if (saved) setReason(''); })}>Save physical condition</Button></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Dated maintenance blocks</h3><Button disabled={!inventoryEditable} onClick={() => setBlockEditor({ draft: { startDate: '', endDate: '', reason: '' } })}>Add dated block</Button></div><p className="text-sm text-muted-foreground">Use a dated block for limited maintenance. The end date is exclusive. Resolve overlapping reservations before saving.</p>
        {blockEditor && <FormField className="space-y-4" onSubmit={event => { event.preventDefault(); void mutate(() => api.saveBlock(selected, blockEditor.draft, blockEditor.block)).then(saved => { if (saved) setBlockEditor(null); }); }}><div className={GRID}><Field label="Block start" type="date" value={blockEditor.draft.startDate} disabled={!inventoryEditable} onChange={startDate => setBlockEditor({ ...blockEditor, draft: { ...blockEditor.draft, startDate } })} /><Field label="Block end (exclusive)" type="date" value={blockEditor.draft.endDate} disabled={!inventoryEditable} onChange={endDate => setBlockEditor({ ...blockEditor, draft: { ...blockEditor.draft, endDate } })} /><Field label="Block reason" value={blockEditor.draft.reason} disabled={!inventoryEditable} onChange={reason => setBlockEditor({ ...blockEditor, draft: { ...blockEditor.draft, reason } })} /></div><div className="flex gap-2"><Button disabled={!inventoryEditable} type="submit">Save dated block</Button><Button variant="outline" disabled={busy} type="button" onClick={() => setBlockEditor(null)}>Cancel</Button></div></FormField>}
        {blocks.map(block => <Card key={block.blockId} className="shadow-none"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-4"><div className="min-w-0"><p>{block.startDate} to {block.endDate}</p><p className="break-words text-sm text-muted-foreground">{block.reason}</p></div><div className="flex gap-2"><Button size="sm" disabled={!inventoryEditable} onClick={() => setBlockEditor({ block, draft: { startDate: block.startDate, endDate: block.endDate, reason: block.reason } })}>Edit block</Button><Button size="sm" variant="outline" disabled={!inventoryEditable} onClick={() => setRemoving(block)}>Remove block</Button></div></CardContent></Card>)}
        {!blocks.length && <p className="text-sm text-muted-foreground">No dated blocks for this room.</p>}
        {removing && <Card className="border-destructive"><CardContent className="space-y-3 p-4"><p>Remove the block from {removing.startDate} to {removing.endDate}?</p><p className="text-sm">This reopens the interval for reservations.</p><div className="flex gap-2"><Button variant="destructive" disabled={!inventoryEditable} onClick={() => void mutate(() => api.removeBlock(selected, removing)).then(saved => { if (saved) setRemoving(null); })}>Confirm remove block</Button><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>Keep block</Button></div></CardContent></Card>}
      </>}</CardContent></Card>}
    </section>}
  </div>;
}

