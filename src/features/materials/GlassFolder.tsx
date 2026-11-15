import { useId } from 'react';
import './folder-art.css';

export function GlassFolder({ empty = false }: { empty?: boolean }) {
  const id = useId();
  return (
    <svg
      className={`lib-folder-art ${empty ? 'is-empty' : ''}`}
      viewBox="0 0 220 200"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`lib-back-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#535353" />
          <stop offset=".45" stopColor="#373737" />
          <stop offset="1" stopColor="#1d1d1d" />
        </linearGradient>
        <linearGradient id={`lib-front-${id}`} x1="0" y1="0" x2="1" y2=".8">
          <stop stopColor="#555" stopOpacity=".95" />
          <stop offset=".48" stopColor="#3a3a3a" stopOpacity=".88" />
          <stop offset="1" stopColor="#292929" stopOpacity=".96" />
        </linearGradient>
        <linearGradient id={`lib-rim-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#bcbcbc" stopOpacity=".65" />
          <stop offset=".4" stopColor="#777" stopOpacity=".2" />
          <stop offset="1" stopColor="#444" stopOpacity=".1" />
        </linearGradient>
        <linearGradient id={`lib-paper-${id}`} x1="0" y1="0" x2=".6" y2="1">
          <stop stopColor="#ededed" />
          <stop offset="1" stopColor="#aaa" />
        </linearGradient>
        <radialGradient id={`lib-light-${id}`} cx=".5" cy="0" r=".9">
          <stop stopColor="#d4d4d4" stopOpacity=".2" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`lib-shadow-${id}`} x="-30%" y="-25%" width="160%" height="170%">
          <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#000" floodOpacity=".35" />
        </filter>
      </defs>
      <ellipse cx="111" cy="181" rx="83" ry="8" fill="#000" opacity=".2" />
      <path
        className="lib-folder-back"
        d="M30 48Q30 34 44 34H82L98 46H180Q194 46 194 60V155Q194 173 177 173H44Q30 173 30 157Z"
        fill={`url(#lib-back-${id})`}
        stroke="#777"
        strokeOpacity=".25"
      />
      {!empty && (
        <g className="lib-folder-papers">
          <path d="M62 32H118L138 51V148H62Z" fill="#b0b0b0" transform="rotate(-8 103 110)" />
          <path d="M86 20H139L160 42V152H86Z" fill={`url(#lib-paper-${id})`} />
          <path d="M139 20V42H160Z" fill="#fff" fillOpacity=".85" />
          <path d="M110 40H154L175 61V154H110Z" fill="#e1e1e1" transform="rotate(7 142 115)" />
          <path
            d="M123 78H150M123 87H159M123 96H154"
            stroke="#777"
            strokeOpacity=".2"
            strokeWidth="2"
            transform="rotate(7 142 115)"
          />
        </g>
      )}
      <path
        d="M192 68Q205 75 205 91V157Q205 169 191 177L187 163V83Z"
        fill="#242424"
        stroke="#6b6b6b"
        strokeOpacity=".2"
      />
      <g className="lib-folder-front" filter={`url(#lib-shadow-${id})`}>
        <path
          d="M22 76Q22 62 36 62H96L114 76H181Q198 76 198 92V158Q198 176 180 176H40Q22 176 22 158Z"
          fill={`url(#lib-front-${id})`}
          stroke={`url(#lib-rim-${id})`}
          strokeWidth="1.2"
        />
        <path
          d="M24 78Q24 64 38 64H95L113 78H180Q196 78 196 93V157Q196 174 180 174H40Q24 174 24 157Z"
          fill={`url(#lib-light-${id})`}
        />
        <path
          d="M36 64H95L113 78H180Q193 78 196 89"
          fill="none"
          stroke="#ddd"
          strokeOpacity=".12"
          strokeWidth="1"
        />
        <text
          x="38"
          y="155"
          fill="#c0c0c0"
          opacity=".35"
          fontSize="12"
          fontFamily="inherit"
          letterSpacing="-.3"
        >
          e-content
        </text>
      </g>
    </svg>
  );
}
