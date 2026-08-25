import { forwardRef, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

// Grows with its content instead of clipping/scrolling — for table cells where long text
// (a remark, a factory name) should wrap onto extra lines rather than truncate.
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, onInput, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null)

    function resize(el: HTMLTextAreaElement | null): void {
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }

    useLayoutEffect(() => {
      resize(innerRef.current)
    })

    return (
      <textarea
        ref={(node) => {
          innerRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        rows={1}
        className={cn(
          'w-full resize-none overflow-hidden rounded-md border bg-bg-base px-2 py-1.5 text-sm text-text-primary',
          'placeholder:text-text-muted transition-all duration-150',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent',
          'border-border hover:border-border-strong',
          className
        )}
        onInput={(e) => {
          resize(e.currentTarget)
          onInput?.(e)
        }}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'
