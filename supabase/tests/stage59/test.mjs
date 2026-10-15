import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const pg = new PGlite();
await pg.exec(fs.readFileSync(new URL('./setup.sql', import.meta.url), 'utf8'));
const migration = fs.readFileSync(process.env.MIG || new URL('../../schema_stage59.sql', import.meta.url), 'utf8');

// --- idempotence: the migration must be safe to run twice ---
await pg.exec(migration);
await pg.exec(migration);
console.log('PASS  migration runs twice without error');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const as = (uid) => pg.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
const attempt = async (sql, params) => { try { return { r: await pg.query(sql, params) }; } catch (e) { return { err: e.message, code: e.code }; } };
const one = async (sql, p) => (await pg.query(sql, p)).rows[0];

const id = () => crypto.randomUUID();
const [ownerU, mgrU, cashierU, mgrNoU, cashierYesU, outsiderU] = [id(), id(), id(), id(), id(), id()];
for (const u of [ownerU, mgrU, cashierU, mgrNoU, cashierYesU, outsiderU]) await pg.query('insert into auth.users(id) values($1)', [u]);
const biz = (await one('insert into businesses(user_id) values($1) returning id', [ownerU])).id;
const otherBiz = (await one('insert into businesses(user_id) values($1) returning id', [outsiderU])).id;
await pg.query(`insert into business_members(business_id,user_id,role,permission_overrides) values
 ($1,$2,'manager','{}'),($1,$3,'cashier','{}'),($1,$4,'manager','{"voidInvoice": false}'),($1,$5,'cashier','{"voidInvoice": true}')`,
 [biz, mgrU, cashierU, mgrNoU, cashierYesU]);

const rice = (await one(`insert into products(business_id,name,type,stock_qty) values($1,'Rice','product',20) returning id`, [biz])).id;
const phone = (await one(`insert into products(business_id,name,type,stock_qty) values($1,'Phone','product',5) returning id`, [biz])).id;
const svc = (await one(`insert into products(business_id,name,type,stock_qty) values($1,'Delivery','service',0) returning id`, [biz])).id;
const stock = async (p) => Number((await one('select stock_qty from products where id=$1', [p])).stock_qty);

async function makeInvoice(num, { paid = false, items } = {}) {
  const inv = (await one(`insert into invoices(business_id,invoice_number,customer_name,total,paid) values($1,$2,'Ada',50000,$3) returning id`, [biz, num, paid])).id;
  for (const [pid, qty] of items) {
    await pg.query('insert into invoice_items(invoice_id,product_id,qty) values($1,$2,$3)', [inv, pid, qty]);
    // emulate deduct_stock_on_sale (Stage 49) for non-service products
    const t = (await one('select type from products where id=$1', [pid])).type;
    if (t !== 'service') await pg.query('update products set stock_qty = stock_qty - $2 where id=$1', [pid, qty]);
  }
  return inv;
}

// ===== 1. Manager voids an unpaid invoice: stock back, movement, event, fields =====
const inv1 = await makeInvoice('INV-0001', { items: [[rice, 5], [phone, 1], [svc, 1]] });
ok('setup: sale deducted rice to 15', await stock(rice) === 15);
await as(mgrU);
const v1 = await attempt('select public.void_invoice($1,$2,$3) as r', [inv1, 'Wrong quantity', 'cashier typed 5']);
ok('manager can void an unpaid invoice', !v1.err, v1.err);
ok('rice stock restored 15 -> 20', await stock(rice) === 20, String(await stock(rice)));
ok('serialized/phone stock restored 4 -> 5', await stock(phone) === 5);
ok('service line untouched (0)', await stock(svc) === 0);
const row = await one('select voided_at, void_reason, void_notes, voided_by from invoices where id=$1', [inv1]);
ok('void fields recorded with who/why', row.voided_at && row.void_reason === 'Wrong quantity' && row.void_notes === 'cashier typed 5' && row.voided_by === mgrU);
const mv = (await pg.query(`select change_qty, reason from stock_movements where invoice_id=$1 order by change_qty`, [inv1])).rows;
ok("stock_movements rows written with reason 'void'", mv.length === 2 && mv.every(m => m.reason === 'void'), JSON.stringify(mv));
const ev = await one(`select metadata from events where event_type='invoice_voided'`);
ok('audit event written with readable summary', ev?.metadata?.summary === 'Voided INV-0001 — Wrong quantity', ev?.metadata?.summary);
ok('invoice_items kept (unit<->invoice record preserved)', (await one('select count(*)::int c from invoice_items where invoice_id=$1', [inv1])).c === 3);

// ===== 2. Double void is refused and does not restock twice =====
const dv = await attempt('select public.void_invoice($1,$2,null)', [inv1, 'again']);
ok('second void refused', /already been voided/.test(dv.err || ''), dv.err);
ok('no double restock', await stock(rice) === 20);

// ===== 3. Role enforcement =====
const inv2 = await makeInvoice('INV-0002', { items: [[rice, 2]] });
await as(cashierU);
const c = await attempt('select public.void_invoice($1,$2,null)', [inv2, 'x']);
ok('cashier cannot void', c.code === '42501', c.err);
await as(outsiderU);
const o = await attempt('select public.void_invoice($1,$2,null)', [inv2, 'x']);
ok("another business's owner cannot void", o.code === '42501', o.err);
await as(null);
const anon = await attempt('select public.void_invoice($1,$2,null)', [inv2, 'x']);
ok('signed-out caller cannot void', anon.code === '42501', anon.err);
await as(mgrNoU);
const mno = await attempt('select public.void_invoice($1,$2,null)', [inv2, 'x']);
ok('manager with voidInvoice:false override is refused', mno.code === '42501', mno.err);
ok('refused attempts changed nothing', await stock(rice) === 18);
await as(cashierYesU);
const cyes = await attempt('select public.void_invoice($1,$2,null)', [inv2, 'Customer cancelled']);
ok('cashier granted voidInvoice:true override CAN void', !cyes.err, cyes.err);
ok('...and stock came back', await stock(rice) === 20);
const inv2b = await makeInvoice('INV-0002B', { items: [[rice, 1]] });
await as(ownerU);
const ow = await attempt('select public.void_invoice($1,$2,null)', [inv2b, 'Duplicate invoice']);
ok('owner (via businesses.user_id) can void', !ow.err, ow.err);

// ===== 4. Reason required =====
const inv3 = await makeInvoice('INV-0003', { items: [[rice, 1]] });
await as(mgrU);
const nr = await attempt(`select public.void_invoice($1,'   ',null)`, [inv3]);
ok('blank reason refused', /reason/i.test(nr.err || ''), nr.err);

// ===== 5. The guard: raw UPDATE cannot forge or undo a void =====
await as(cashierU);
const forge = await attempt(`update invoices set voided_at = now(), void_reason='sneaky' where id=$1`, [inv3]);
ok('raw update cannot set voided_at (forged void blocked)', forge.code === '42501', forge.err);
const unvoid = await attempt(`update invoices set voided_at = null where id=$1`, [inv1]);
ok('raw update cannot un-void', unvoid.code === '42501', unvoid.err);
const ins = await attempt(`insert into invoices(business_id,invoice_number,customer_name,voided_at) values($1,'X','y',now())`, [biz]);
ok('cannot insert an invoice already voided', ins.code === '42501', ins.err);
const harmless = await attempt(`update invoices set customer_name='Ada B' where id=$1`, [inv3]);
ok('ordinary updates still work', !harmless.err, harmless.err);
ok('guard left the voided_at flag alone after attempts', (await one('select voided_at from invoices where id=$1', [inv1])).voided_at !== null);

// ===== 6. Payments block the void; refund unblocks it =====
const inv4 = await makeInvoice('INV-0004', { paid: true, items: [[rice, 3]] });
await pg.query(`insert into invoice_payments(invoice_id,method,amount) values($1,'cash',20000),($1,'transfer',30000)`, [inv4]);
await as(mgrU);
const bp = await attempt('select public.void_invoice($1,$2,null)', [inv4, 'Wrong price']);
ok('void BLOCKED while payments recorded', /50,000\.00 in payments recorded/.test(bp.err || ''), bp.err);
ok('blocked void did not restock', await stock(rice) === 16, String(await stock(rice)));
const pays = (await pg.query('select id, amount from invoice_payments where invoice_id=$1 order by amount', [inv4])).rows;
await as(cashierU);
const cr = await attempt('select public.refund_invoice_payment($1,$2)', [pays[0].id, 'x']);
ok('cashier cannot refund a payment', cr.code === '42501', cr.err);
await as(mgrU);
const nr2 = await attempt(`select public.refund_invoice_payment($1,'')`, [pays[0].id]);
ok('refund requires a reason', /reason/i.test(nr2.err || ''), nr2.err);
const r1 = await attempt('select public.refund_invoice_payment($1,$2)', [pays[0].id, 'Customer returned goods']);
ok('manager refunds first payment', !r1.err, r1.err);
ok('invoice flipped back to unpaid (remaining < total)', (await one('select paid, paid_at from invoices where id=$1', [inv4])).paid === false);
const still = await attempt('select public.void_invoice($1,$2,null)', [inv4, 'Wrong price']);
ok('still blocked with one payment left', /30,000\.00 in payments recorded/.test(still.err || ''), still.err);
const r2 = await attempt('select public.refund_invoice_payment($1,$2)', [pays[1].id, 'Customer returned goods']);
ok('manager refunds second payment', !r2.err, r2.err);
const arch = (await pg.query('select amount, method, refund_reason, refunded_by from invoice_payment_refunds where invoice_id=$1 order by amount', [inv4])).rows;
ok('both payments archived with reason + who', arch.length === 2 && arch.every(a => a.refund_reason === 'Customer returned goods' && a.refunded_by === mgrU), JSON.stringify(arch));
ok('invoice_payments now empty (existing sums stay correct)', (await one('select count(*)::int c from invoice_payments where invoice_id=$1', [inv4])).c === 0);
const again = await attempt('select public.refund_invoice_payment($1,$2)', [pays[0].id, 'dup']);
ok('refunding an already-refunded payment is refused', /not found|already/i.test(again.err || ''), again.err);
const nowOk = await attempt('select public.void_invoice($1,$2,null)', [inv4, 'Wrong price']);
ok('void now SUCCEEDS after refunds', !nowOk.err, nowOk.err);
ok('stock restored for that invoice too (16 -> 19)', await stock(rice) === 19, String(await stock(rice)));
const evs = (await pg.query(`select event_type from events where event_type like 'invoice_%' order by created_at`)).rows.map(e => e.event_type);
ok('refund + void both audited', evs.filter(e => e === 'invoice_payment_refunded').length === 2 && evs.filter(e => e === 'invoice_voided').length >= 3, evs.join(','));

// ===== 7. Legacy: flagged paid with no payment rows =====
const inv5 = await makeInvoice('INV-0005', { paid: true, items: [[rice, 1]] });
const lg = await attempt('select public.void_invoice($1,$2,null)', [inv5, 'x']);
ok('legacy paid-flag invoice blocked with a clear instruction', /marked as paid\. Mark it as unpaid first/.test(lg.err || ''), lg.err);

// ===== 8. "Unpaid" flag but payment rows still present (the existing unmark-paid quirk) =====
const inv6 = await makeInvoice('INV-0006', { paid: false, items: [[rice, 1]] });
await pg.query(`insert into invoice_payments(invoice_id,method,amount) values($1,'cash',5000)`, [inv6]);
const q = await attempt('select public.void_invoice($1,$2,null)', [inv6, 'x']);
ok('unpaid-flag-but-has-payment-rows is still blocked', /5,000\.00 in payments recorded/.test(q.err || ''), q.err);

// ===== 9. Product deleted after the sale: skipped, no crash =====
const gone = (await one(`insert into products(business_id,name,type,stock_qty) values($1,'Gone','product',9) returning id`, [biz])).id;
const inv7 = await makeInvoice('INV-0007', { items: [[gone, 2]] });
await pg.query('delete from products where id=$1', [gone]);
const dg = await attempt('select public.void_invoice($1,$2,null)', [inv7, 'Wrong customer']);
ok('void works when a sold product has since been deleted', !dg.err, dg.err);

// ===== 10. Refund allowed on an already-voided invoice (late online payment) =====
const inv8 = await makeInvoice('INV-0008', { items: [[rice, 1]] });
await attempt('select public.void_invoice($1,$2,null)', [inv8, 'Duplicate invoice']);
const late = (await one(`insert into invoice_payments(invoice_id,method,amount) values($1,'transfer',9000) returning id`, [inv8])).id;
const lr = await attempt('select public.refund_invoice_payment($1,$2)', [late, 'Paid after void']);
ok('a late payment on a voided invoice can still be refunded', !lr.err, lr.err);

// ===== 11. Stock-movement reasons: old ones still valid, junk still rejected =====
await as(ownerU);
ok("old reason 'sale' still allowed", !(await attempt(`insert into stock_movements(business_id,product_id,change_qty,reason) values($1,$2,-1,'sale')`, [biz, rice])).err);
ok('junk reason still rejected', !!(await attempt(`insert into stock_movements(business_id,product_id,change_qty,reason) values($1,$2,-1,'bogus')`, [biz, rice])).err);
ok('exactly one reason CHECK remains (old one replaced, not duplicated)',
  (await one(`select count(*)::int c from pg_constraint where conrelid='stock_movements'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%reason%'`)).c === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
