import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>
const defaults: IconProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }

export function DashboardIcon(p: IconProps) {
  return <svg {...defaults} {...p}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
}
export function JobsIcon(p: IconProps) {
  return <svg {...defaults} {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
}
export function ConnectorsIcon(p: IconProps) {
  return <svg {...defaults} {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
}
export function RepositoriesIcon(p: IconProps) {
  return <svg {...defaults} {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
}
export function RoutingIcon(p: IconProps) {
  return <svg {...defaults} {...p}><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
}
export function ScenariosIcon(p: IconProps) {
  return <svg {...defaults} {...p}><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/></svg>
}
export function ChannelsIcon(p: IconProps) {
  return <svg {...defaults} {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
}
export function ProvidersIcon(p: IconProps) {
  return <svg {...defaults} {...p}><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1"/><circle cx="6" cy="18" r="1"/></svg>
}
export function ApiKeysIcon(p: IconProps) {
  return <svg {...defaults} {...p}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
}
export function ReviewIcon(p: IconProps) {
  return <svg {...defaults} {...p}><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.5 0 2.91.37 4.15 1.02"/></svg>
}
export function SettingsIcon(p: IconProps) {
  return <svg {...defaults} {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}
export function SearchIcon(p: IconProps) {
  return <svg {...defaults} {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}
export function BellIcon(p: IconProps) {
  return <svg {...defaults} {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
}
export function PlusIcon(p: IconProps) {
  return <svg {...defaults} strokeWidth={2} {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
export function DownloadIcon(p: IconProps) {
  return <svg {...defaults} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}
export function RefreshIcon(p: IconProps) {
  return <svg {...defaults} {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
}
export function ChevronLeftIcon(p: IconProps) {
  return <svg {...defaults} width={14} height={14} strokeWidth={2} {...p}><polyline points="15 18 9 12 15 6"/></svg>
}
export function ChevronRightIcon(p: IconProps) {
  return <svg {...defaults} width={14} height={14} strokeWidth={2} {...p}><polyline points="9 18 15 12 9 6"/></svg>
}
export function BoltIcon(p: IconProps) {
  return <svg {...defaults} strokeWidth={2.5} strokeLinecap="round" {...p}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
}
export function ActivityIcon(p: IconProps) {
  return <svg {...defaults} strokeWidth={2} {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
}
export function AlertCircleIcon(p: IconProps) {
  return <svg {...defaults} strokeWidth={2} {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
}
export function XCircleIcon(p: IconProps) {
  return <svg {...defaults} strokeWidth={2} {...p}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
}
