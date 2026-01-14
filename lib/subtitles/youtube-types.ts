export interface TimedtextEvent {
  tStartMs: number
  dDurationMs?: number
  segs?: {
    utf8: string
    tOffsetMs?: number
    acAsrConf?: number
  }[]
  wWinId?: 1
  aAppend?: 1
}

export interface GetTimedtextResp {
  events: TimedtextEvent[]
}
