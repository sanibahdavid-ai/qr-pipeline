import { NextRequest, NextResponse } from 'next/server'
import { EdgeTTS } from 'edge-tts-universal'
import { requireDirector } from "@/lib/director-auth";

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const denied = await requireDirector(req);
  if (denied) return denied;
  try {
    const { text, voice, rate } = await req.json()

    if (!text || !voice) {
      return NextResponse.json({ error: 'text and voice required' }, { status: 400 })
    }

    console.log('[tts-edge] voice:', voice, 'rate:', rate, 'chars:', text.length)

    const tts = new EdgeTTS(text, voice, {
      rate: rate ?? '+0%',
      volume: '+0%',
      pitch: '+0Hz',
    })

    const result = await tts.synthesize()
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer())

    console.log('[tts-edge] OK, audio size:', audioBuffer.length, 'bytes')

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'inline; filename="speech.mp3"',
      },
    })
  } catch (error) {
    console.error('[tts-edge] error:', error)
    return NextResponse.json({ error: 'TTS generation failed', details: String(error) }, { status: 500 })
  }
}
