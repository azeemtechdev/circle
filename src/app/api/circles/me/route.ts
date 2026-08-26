import { NextResponse } from 'next/server';

import { getCircleRouteClient } from '@/lib/circles/route-helpers';

export async function GET() {
  const client = getCircleRouteClient();
  if (!client) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const { data: userResp, error: userErr } = await client.auth.getUser();
  if (userErr) {
    return NextResponse.json({ error: userErr.message ?? 'Authentication failed.' }, { status: 500 });
  }

  const user = userResp?.user ?? null;
  if (!user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const memberships = await client.from('memberships').select('circle_id').eq('user_id', user.id).neq('status', 'left');
    const circleIds = Array.isArray((memberships as any).data) ? (memberships as any).data.map((m: any) => m.circle_id).filter(Boolean) : [];

    if (circleIds.length === 0) {
      return NextResponse.json({ circles: [] }, { status: 200 });
    }

    const circlesResp = await client.from('circles').select('id, name, status, amount_kobo, member_target, period_days').in('id', circleIds);
    const circles = (circlesResp as any).data ?? [];

    return NextResponse.json({ circles }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unable to load circles.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
