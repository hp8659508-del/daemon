grant all on public.evaluation_scores to postgres, service_role;
grant all on public.certificates      to postgres, service_role;

select t.paddle, t.team_name, e.impact as real_world, e.innovation as uniq,
       e.presentation, e.prototype,
       e.impact + e.innovation + e.presentation + e.prototype as total
from public.teams t join public.evaluation_scores e on e.team_id = t.id
order by t.paddle;
