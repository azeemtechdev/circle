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
    id?: string;
  };

  try {
    const client = getCircleRouteClient(request);
    if (!client) {
      return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
    }

    const service = new CircleService(new SupabaseCirclePort(client));
    const id = await service.confirmContribution({
      idempotencyKey,
      id: body.id ?? '',
    });

    return NextResponse.json({ id }, { status: 200 });
  } catch (error) {
    return circleErrorResponse(error);
  }
}
