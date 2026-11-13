// The Music and Sound switches as two icon buttons (Ardian 2026-11-13): the same buttons, icons and
// switches (localStorage nearvest.music / nearvest.sfx, audio.ts setAudioPrefs) in the village HUD
// and in the Arena duel's title bar. Music only turns music off (Tandur's loop and the Arena track),
// Sound only turns the sound effects and ambient sounds off.

import { useEffect, useState } from 'preact/hooks';
import { getAudioPrefs, onAudioPrefsChange, setAudioPrefs } from './audio';
import { Sprite } from './sprites';

export function AudioButtons({ class: cls = '' }: { class?: string }) {
  const [audio, setAudio] = useState(getAudioPrefs());
  useEffect(() => onAudioPrefsChange(setAudio), []);
  return (
    <>
      <button
        class={`icon-btn audio-music${cls ? ` ${cls}` : ''}`}
        onClick={() => setAudioPrefs({ music: !audio.music })}
        aria-pressed={audio.music}
        aria-label={audio.music ? 'Turn music off' : 'Turn music on'}
        title={audio.music ? 'Music on' : 'Music off'}
      >
        <Sprite name={audio.music ? 'music' : 'musicOff'} scale={3} />
      </button>
      <button
        class={`icon-btn audio-sfx${cls ? ` ${cls}` : ''}`}
        onClick={() => setAudioPrefs({ sfx: !audio.sfx })}
        aria-pressed={audio.sfx}
        aria-label={audio.sfx ? 'Turn sound effects off' : 'Turn sound effects on'}
        title={audio.sfx ? 'Sound effects on' : 'Sound effects off'}
      >
        <Sprite name={audio.sfx ? 'speaker' : 'speakerOff'} scale={3} />
      </button>
    </>
  );
}
