export function Mascot({ skin = 'cat', happy = false }: { skin?: 'cat' | 'bunny'; happy?: boolean }): React.JSX.Element {
  const bunny = skin === 'bunny'
  return <svg className={`pet-mascot ${happy ? 'is-happy' : ''}`} viewBox="0 0 160 150" role="img" aria-label={bunny ? '草莓兔兔' : '奶油猫咪'}>
    <ellipse cx="80" cy="139" rx="46" ry="7" fill="#66517d" opacity=".09" />
    <g className="pet-breathe">
      {bunny ? <><ellipse cx="57" cy="38" rx="15" ry="31" fill="#fff5f4" stroke="#d8a6b1" strokeWidth="2.5" transform="rotate(-12 57 38)"/><ellipse cx="104" cy="36" rx="15" ry="32" fill="#fff5f4" stroke="#d8a6b1" strokeWidth="2.5" transform="rotate(12 104 36)"/><ellipse cx="57" cy="34" rx="6" ry="19" fill="#f8c0ce"/><ellipse cx="104" cy="32" rx="6" ry="20" fill="#f8c0ce"/></> : <><path d="M33 64 29 21Q50 19 65 48M97 48Q118 19 132 23L129 69" fill="#fff2dc" stroke="#c6aa8c" strokeWidth="2.5"/><path d="m38 48-2-17 17 16m57 0 15-14-2 20" fill="#f2b8b8"/></>}
      <ellipse cx="80" cy="112" rx="38" ry="27" fill={bunny ? '#ffe2e9' : '#f5dfbf'} stroke={bunny ? '#d8a6b1' : '#c6aa8c'} strokeWidth="2.5"/>
      <rect x="25" y="44" width="110" height="78" rx="37" fill={bunny ? '#fff5f4' : '#fff2dc'} stroke={bunny ? '#d8a6b1' : '#c6aa8c'} strokeWidth="2.5"/>
      <g className="pet-eyes" stroke="#695063" strokeWidth="4" strokeLinecap="round" fill="none">{happy ? <><path d="m53 78 6-5 6 5"/><path d="m96 78 6-5 6 5"/></> : <><path d="M59 75v5"/><path d="M102 75v5"/></>}</g>
      <ellipse cx="45" cy="89" rx="10" ry="6" fill="#f5aebb" opacity=".65"/><ellipse cx="115" cy="89" rx="10" ry="6" fill="#f5aebb" opacity=".65"/>
      <path d="m76 84 4 3 4-3m-4 3q0 10-9 5m9-5q0 10 9 5" fill="none" stroke="#916c7b" strokeWidth="2" strokeLinecap="round"/>
      <path d="m65 114 15 7 15-7" fill="none" stroke="#d49ab4" strokeWidth="5" strokeLinecap="round"/>
      <ellipse cx="56" cy="133" rx="13" ry="7" fill="#fff5e8"/><ellipse cx="104" cy="133" rx="13" ry="7" fill="#fff5e8"/>
      <path d="m79 116 5-5 5 5-5 7Z" fill="#c29bd6"/>
    </g>
    <g fill="#deb1dd"><path d="m143 53 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z"/><circle cx="18" cy="91" r="3"/></g>
  </svg>
}
