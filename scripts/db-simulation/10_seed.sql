insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','host@x'),('00000000-0000-0000-0000-0000000000a2','idea@x'),('00000000-0000-0000-0000-0000000000a3','incub@x');
insert into public.profiles(id,role,venue) values ('00000000-0000-0000-0000-0000000000a1','admin',null),('00000000-0000-0000-0000-0000000000a2','admin','Idea Lab'),('00000000-0000-0000-0000-0000000000a3','admin','Incubation Center');
-- the 38 real teams + 12 extra to reach 50 teams / 200 participants
insert into public.teams(team_name,username)
select n, upper(regexp_replace(n,'[^A-Za-z0-9]+','_','g')) from unnest(array['AppVengers','Boomers','Code berry','Codelulu','CodeVengers','D3CODE','DBC','DevSync','Energy','Fabulous Four','Firewalls','Frontier','Goodachari Grid','GPT Warriors','Hakuna Matata','Hallucination station','Immortal','Logic Legends','LoopX','Mechforge','NuronX','Quadra','Quantum Crew','S⁴','Sentinel','Straw Hats','Synergy','TEAM GAMMA','Team Raju','Team TRPS','Techies','Teen-Bhai-Teeno-tabahi','Tejaswini K','TEST ALPHA','TEST BETA','The Outliers','TriCore','Velocity Build']) n;
update public.teams set username='S' where team_name='S⁴';
insert into public.teams(team_name,username,bay) select 'Extra '||g, 'EXTRA_'||g, case when g%2=0 then 'Idea Lab' else 'Incubation Center' end from generate_series(1,12) g;
-- team login users
insert into auth.users(id,email) select gen_random_uuid(), lower(username)||'@teams' from public.teams;
insert into public.profiles(id,role,team_id) select u.id,'team',t.id from public.teams t join auth.users u on u.email=lower(t.username)||'@teams';
-- re-run v3 allocation + paddles + v5 secrets now that teams exist
