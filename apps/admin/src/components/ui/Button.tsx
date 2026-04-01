import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: ReactNode
  children: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700',
  secondary:
    'bg-white/6 text-gray-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-white/10 hover:text-gray-200',
  danger: 'bg-signal-red-500 text-white hover:bg-red-600',
  ghost: 'bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700',
}

export function Button({
  variant = 'secondary',
  icon,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3.5 py-[7px] text-[13px] font-medium whitespace-nowrap transition-all duration-100 cursor-pointer ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {icon && <span className="[&>svg]:h-[15px] [&>svg]:w-[15px]">{icon}</span>}
      {children}
    </button>
  )
}
