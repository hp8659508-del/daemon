-- Auction: +1000 auction points for EVERY team (budget 1000 → 2000).
-- Each team's wallet = budget − what it already spent, so a team that spent 800 goes from 200 → 1200.
-- Main points are not touched. Also lifts any card maximum below 2000 so prices above 500 can be set.
-- Run ONCE (running again adds another 1000).
begin;
update public.event_settings set auction_budget = coalesce(auction_budget, 1000) + 1000 where id = true;
update public.auction_items set max_price = null where max_price is not null and max_price < 2000 and coalesce(pool,'auction') <> 'spin';
commit;

select t.paddle as no, t.team_name, public.dh_auction_pts(t.id) as auction_left,
       (select auction_budget from public.event_settings where id = true) as budget
from public.teams t order by t.paddle;
