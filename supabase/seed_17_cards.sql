-- ============================================================================
-- DAEMON HOUR · the 17 auction cards (optional). Run AFTER ui_v9_cards.sql.
-- Adds each card only if a card with that name doesn't exist yet.
-- Opening price 50 / step 10 / no min-max: edit prices in Auction → Cards.
-- ============================================================================
insert into public.auction_items (item_name, description, kind, effect, base_points, price_step, quantity, is_active)
select v.name, v.descr, v.kind, v.effect::jsonb, 50, 10, 1, true
from (values
  ('+15 min',                          'Adds 15 minutes to your deadline',                         'time',   '{"minutes":15}'),
  ('+20 min',                          'Adds 20 minutes to your deadline',                         'time',   '{"minutes":20}'),
  ('+35 min',                          'Adds 35 minutes to your deadline',                         'time',   '{"minutes":35}'),
  ('Be the first team to present',     'Your team presents first',                                 'note',   '{"phase":"presentation","perk":"none"}'),
  ('Expert guidance throughout',       'An expert guides you throughout the build',                'note',   '{"phase":"build","perk":"none"}'),
  ('No penalties',                     'Blocks the next penalty given to your team (once)',        'note',   '{"phase":"penalty","perk":"no_penalty"}'),
  ('Pass penalties',                   'Your next penalty goes to the next team in your venue (once)', 'note', '{"phase":"penalty","perk":"pass_penalty"}'),
  ('Choose your problem statement',    'Pick your own problem statement',                          'note',   '{"phase":"ps","perk":"none"}'),
  ('Swap problem statement',           'Swap your problem statement with any team (once, final)',  'note',   '{"phase":"ps","perk":"swap_ps"}'),
  ('+10 points',                       'Adds 10 points to your total',                             'points', '{"amount":10}'),
  ('Cover one box on BINGO',           'An organiser stamps one box of your bingo sheet',          'bingo',  '{"mode":"cell"}'),
  ('Spin again if disadvantaged',      'Re-spin the wheel if you land on a disadvantage',          'note',   '{"phase":"spin","perk":"none"}'),
  ('10 min: expert does your build',   'An expert builds for you for 10 minutes',                  'note',   '{"phase":"build","perk":"none"}'),
  ('Fewer questions in presentation',  'Judges ask fewer questions during your presentation',      'note',   '{"phase":"presentation","perk":"none"}'),
  ('1st column done on BINGO',         'Completes column B of your bingo sheet',                   'bingo',  '{"mode":"column","column":0}'),
  ('Trump card',                       'Becomes a copy of any card in the list — you choose',      'trump',  '{}'),
  ('Present online at 8:30 pm',        'Your team presents online at 8:30 pm',                     'note',   '{"phase":"presentation","perk":"none"}')
) as v(name, descr, kind, effect)
where not exists (select 1 from public.auction_items i where i.item_name = v.name);
