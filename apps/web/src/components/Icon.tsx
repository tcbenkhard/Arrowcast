const paths = {
  trophy: 'M8 3h8v6a4 4 0 0 1-8 0ZM8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4M12 13v8M8 21h8',
  pencil: 'm16 3 5 5-12 12-6 1 1-6ZM14 5l5 5',
  checklist: 'M9 5h11M9 12h11M9 19h11M3 4l1 1 2-2M3 11l1 1 2-2M3 18l1 1 2-2',
  play: 'm8 4 13 8-13 8Z',
  finish: 'M5 21V3h14v12H5M5 3l14 12M19 3 5 15M12 3v12M5 9h14',
  settings:
    'M10 2h4l.5 3 1.5.6 2.5-1.7 1.6 1.6L18.4 8l.6 1.5 3 .5v4l-3 .5-.6 1.5 1.7 2.5-1.6 1.6L16 18.4l-1.5.6-.5 3h-4l-.5-3-1.5-.6-2.5 1.7-1.6-1.6L5.6 16 5 14.5 2 14v-4l3-.5L5.6 8 3.9 5.5l1.6-1.6L8 5.6 9.5 5ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  range: 'M3 21V3M3 7h18M7 7v14M14 7v14M21 7v14M3 21h18',
  target:
    'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  users:
    'M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M3 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2M18 3a4 4 0 0 1 0 8M21 14a5 5 0 0 1 2 5v2',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  network: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M2 12h20M12 2a20 20 0 0 1 0 20 20 20 0 0 1 0-20',
  import: 'M14 2H4v20h16V8ZM14 2v6h6M8 14h8m-3-3 3 3-3 3',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="ui-icon"
      width={name === 'settings' || name === 'trophy' ? 24 : 20}
      height={name === 'settings' || name === 'trophy' ? 24 : 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
