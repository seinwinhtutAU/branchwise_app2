import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { WarningIcon } from '@renderer/components/ui/icons'

// Why this exists: React unmounts the entire tree when a render throws and nothing
// catches it, so one page's mistake — a list arriving in a shape it didn't expect, say —
// took the whole window down to a blank white screen with the error visible only in
// DevTools. A blank window tells a shop manager nothing, and tells a developer nothing
// either. This keeps the failure inside the section that caused it: the sidebar stays
// usable, the message names the section, and Try again re-renders it (`resetKey` also
// clears it automatically on navigating elsewhere).
//
// Deliberately not wrapped around the whole shell: an error boundary that replaces the
// nav as well leaves nowhere to go but a reload.

interface Props {
  children: ReactNode
  /** Changing this clears the error — pass the active section, so navigating away recovers. */
  resetKey?: string
  /** Named in the message, so the report says which screen failed. */
  label?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is where this is actually read from (Electron's DevTools, or the
    // renderer log), so keep the component stack with it rather than only the message.
    console.error('Section crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <EmptyState
        icon={<WarningIcon />}
        title={this.props.label ? `${this.props.label} couldn't be shown` : "This page couldn't be shown"}
        description={`Something went wrong rendering it: ${this.state.error.message}. The rest of the app still works — pick another section from the sidebar, or try again.`}
        action={
          <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        }
      />
    )
  }
}

export default ErrorBoundary
