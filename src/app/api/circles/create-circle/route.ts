import { NextResponse } from 'next/server';

import { CircleService } from '@/lib/circles/circles';
import { circleErrorResponse, getCircleRouteClient, getIdempotencyKey } from '@/lib/circles/route-helpers';
import { SupabaseCirclePort } from '@/lib/circles/supabase-port';

export async function POST(request: Request) {
  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
  }

  const body = (await request.json()) as {
    name?: string;
    amountKobo?: number | string;
    periodDays?: number;
    memberTarget?: number;
  };

  try {
    const client = getCircleRouteClient(request);
    if (!client) {
      return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
    }

    const service = new CircleService(new SupabaseCirclePort(client));
    const amountKobo = typeof body.amountKobo === 'string' ? BigInt(body.amountKobo) : BigInt(body.amountKobo ?? 0);

    const id = await service.createCircle({
      idempotencyKey,
      name: body.name ?? '',
      amountKobo,
      periodDays: body.periodDays ?? 0,
      memberTarget: body.memberTarget ?? 0,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return circleErrorResponse(error);
  }
}
