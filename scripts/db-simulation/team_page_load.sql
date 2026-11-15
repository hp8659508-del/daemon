\set n random(0, 49)
select id into temp t_pick from teams order by paddle offset :n limit 1;
select id,team_name,username,bay,paddle from teams order by paddle;
select * from team_stages where team_id=(select id from t_pick);
select * from auction_items order by item_name;
select * from powerups order by created_at;
select * from team_powerups where team_id=(select id from t_pick) or target_team_id=(select id from t_pick);
select id,team_id,item_id,purchase_price,created_at from purchases order by created_at desc;
select id,team_id,description,points,created_at from transactions where team_id=(select id from t_pick) order by created_at desc limit 300;
select * from bingo_cells order by idx;
select team_id,idx,marked_at from team_bingo where team_id=(select id from t_pick);
select * from event_settings where id;
select id,kind,action,label from activity_log where team_id=(select id from t_pick) order by created_at desc limit 300;
select * from team_members where team_id=(select id from t_pick) order by role, created_at;
select * from help_requests where team_id=(select id from t_pick) and status='open';
select * from team_balances();
drop table t_pick;
