import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>
type PlatformIcon = React.ComponentType<{ className?: string }>

const svgProps: IconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
}

function PuzzleIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path
        fill="currentColor"
        d="M9 3a3 3 0 0 0-3 3v1H4a2 2 0 0 0-2 2v3h2.1a2.4 2.4 0 1 1 0 4.8H2v3a2 2 0 0 0 2 2h4v-2.1a2.4 2.4 0 1 1 4.8 0V22h7a2 2 0 0 0 2-2v-4h-2.1a2.4 2.4 0 1 1 0-4.8H22V9a2 2 0 0 0-2-2h-4V6a3 3 0 0 0-3-3H9Z"
      />
    </svg>
  )
}

export function AppsIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" fill="currentColor" />
    </svg>
  )
}

export function SentryIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path
        fill="currentColor"
        d="M12 2.5a9.5 9.5 0 0 1 9.26 7.35h-3.08A6.72 6.72 0 0 0 12 5.28a6.72 6.72 0 0 0-6.6 8.08H2.3A9.5 9.5 0 0 1 12 2.5Zm-2.3 6.12a4.67 4.67 0 0 1 6.56.97l3.36 4.77h-3.2l-2.72-3.85a1.96 1.96 0 0 0-3.19 2.27l3.92 5.56h-3.2l-3.03-4.3a4.66 4.66 0 0 1 1.5-6.42Z"
      />
    </svg>
  )
}

export function CrashlyticsIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path
        fill="currentColor"
        d="M13.82 2.25c.5 2.9-1.05 4.76-2.48 6.2-1.26 1.28-2.34 2.38-2.34 4.28 0 1.76 1.16 3.1 2.88 3.1 2.34 0 3.87-1.95 3.87-4.43 0-1.12-.34-2.32-.97-3.54A8.35 8.35 0 0 1 19.5 15c0 4.1-3.13 6.75-7.5 6.75S4.5 19.1 4.5 15.13c0-3.8 2.36-5.9 4.64-7.95 1.9-1.68 3.7-3.28 4.68-4.93Z"
      />
    </svg>
  )
}

export function LinearIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path fill="currentColor" d="M6 3h3v11.76L17.64 6.1l2.12 2.12L11.12 16.9H18V20H6V3Z" />
    </svg>
  )
}

export function GitHubIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.21.68-.48 0-.24-.01-1.03-.01-1.87-2.78.62-3.37-1.2-3.37-1.2-.45-1.2-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.04 1.53 1.04.88 1.55 2.32 1.1 2.89.84.09-.66.35-1.1.63-1.35-2.22-.26-4.56-1.14-4.56-5.05 0-1.11.39-2.02 1.03-2.74-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.76 1.04A9.5 9.5 0 0 1 12 6.83c.85 0 1.69.12 2.48.34 1.92-1.32 2.76-1.04 2.76-1.04.55 1.42.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.74 0 3.92-2.34 4.79-4.58 5.03.36.32.68.95.68 1.92 0 1.39-.01 2.5-.01 2.85 0 .28.18.6.69.49A10.23 10.23 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"
      />
    </svg>
  )
}

export function GitHubIssuesIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.21.68-.48 0-.24-.01-1.03-.01-1.87-2.78.62-3.37-1.2-3.37-1.2-.45-1.2-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.04 1.53 1.04.88 1.55 2.32 1.1 2.89.84.09-.66.35-1.1.63-1.35-2.22-.26-4.56-1.14-4.56-5.05 0-1.11.39-2.02 1.03-2.74-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.76 1.04A9.5 9.5 0 0 1 12 6.83c.85 0 1.69.12 2.48.34 1.92-1.32 2.76-1.04 2.76-1.04.55 1.42.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.74 0 3.92-2.34 4.79-4.58 5.03.36.32.68.95.68 1.92 0 1.39-.01 2.5-.01 2.85 0 .28.18.6.69.49A10.23 10.23 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"
      />
      <circle cx="18.25" cy="5.75" r="2.75" fill="currentColor" />
    </svg>
  )
}

export function JiraIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path
        fill="currentColor"
        d="M12 2.5 16.7 7.2 12 11.9 7.3 7.2 12 2.5Zm5.2 5.2 4.3 4.3L12 21.5l-4.3-4.3 9.5-9.5ZM6.8 7.7l3.25 3.25-3.25 3.25L2.5 9.95 6.8 7.7Z"
      />
    </svg>
  )
}

export function TrelloIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
      <rect x="7" y="7" width="4" height="10" rx="1" fill="currentColor" />
      <rect x="13" y="7" width="4" height="6" rx="1" fill="currentColor" />
    </svg>
  )
}

export function GitLabIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path
        fill="currentColor"
        d="M12 21.25 16.18 12h3.49L17.32 5.2 14.4 7.38 12 2.75 9.6 7.38 6.68 5.2 4.33 12h3.5L12 21.25Z"
      />
    </svg>
  )
}

export function BitbucketIcon({ className, ...props }: IconProps) {
  return (
    <svg {...svgProps} className={className} {...props}>
      <path
        fill="currentColor"
        d="M5.5 5.25h13l-1.9 11.2a2 2 0 0 1-1.97 1.67H9.37A2 2 0 0 1 7.4 16.45L5.5 5.25Zm1.78-2h9.44l.56 1.75H6.72l.56-1.75Zm3.15 6.4h5.14l-.8 4.62h-3.54l-.8-4.62Z"
      />
    </svg>
  )
}

const platformIcons: Record<string, PlatformIcon> = {
  sentry: SentryIcon,
  'firebase-crashlytics': CrashlyticsIcon,
  linear: LinearIcon,
  github: GitHubIcon,
  'github-issues': GitHubIssuesIcon,
  jira: JiraIcon,
  trello: TrelloIcon,
  gitlab: GitLabIcon,
  bitbucket: BitbucketIcon,
}

// eslint-disable-next-line react-refresh/only-export-components
export function getPlatformIcon(iconSlug: string): React.ComponentType<{ className?: string }> {
  return platformIcons[iconSlug] ?? PuzzleIcon
}

export function PlatformIcon({ slug, className }: { slug: string; className?: string }) {
  const Comp = platformIcons[slug] ?? PuzzleIcon
  return <Comp className={className} />
}
