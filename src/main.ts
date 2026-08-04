import { bootstrapYomuApp } from './platform/bootstrap'
import { createPlatformBootstrapForCurrentTarget } from './platform/createPlatformServices'
import './styles/main.css'

const { services, initialization } = await createPlatformBootstrapForCurrentTarget()
await bootstrapYomuApp({
  platformServices: services,
  initialization,
})
