import React from 'react'
import { Composition } from 'remotion'
import { Video } from './Video'

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SleepMemoryZH"
        component={Video}
        defaultProps={{ lang: 'zh' }}
        durationInFrames={1080}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="SleepMemoryEN"
        component={Video}
        defaultProps={{ lang: 'en' }}
        durationInFrames={1080}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  )
}
