import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Root from './Root'
import { PasswordRecoveryGate } from './tracking/PasswordRecovery'
import { consumeRecoveryFragment } from './tracking/recoveryFragment'

const recoveryLink = consumeRecoveryFragment(window.location, window.history)
const clearCapturedRecovery = () => { if (recoveryLink) recoveryLink.token = null }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordRecoveryGate initialLink={recoveryLink} onCaptured={clearCapturedRecovery}><Root /></PasswordRecoveryGate>
  </StrictMode>,
)
