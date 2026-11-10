export const SAMPLE_SQL = `with recent_orders as (select o.id, o.customer_id, o.total_cents, o.created_at from orders o where o.created_at >= now() - interval '30 days' and o.status in ('paid','shipped')), ranked as (select customer_id, sum(total_cents) as spent, count(*) as n, rank() over (order by sum(total_cents) desc) as rnk from recent_orders group by customer_id)
select c.id, c.email, r.spent / 100.0 as spent_usd, r.n as orders, coalesce(c.meta->>'tier', 'standard') as tier from ranked r join customers c on c.id = r.customer_id where r.rnk <= 20 and c.deleted_at is null order by r.spent desc limit 20;
-- refresh the cached stats
update customer_stats set last_order_at = sub.max_at, updated_at = now() from (select customer_id, max(created_at) as max_at from orders group by customer_id) sub where customer_stats.customer_id = sub.customer_id and customer_stats.last_order_at is distinct from sub.max_at;
create index concurrently if not exists orders_customer_created_idx on orders (customer_id, created_at desc) where status <> 'cancelled';
`;
