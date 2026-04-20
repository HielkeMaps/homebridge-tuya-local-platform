import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import MotorizedHatchAccessory from '../src/accessories/MotorizedHatch.accessory'
import {
  createMockLogger,
  createMockTuyaDevice,
  createMockPlatformAccessory,
  createMockCharacteristic,
  createMockService,
  createMockCategories,
} from './helpers'

function createHatch(contextOverrides: Record<string, unknown> = {}) {
  const device = createMockTuyaDevice({
    name: 'Dakluik',
    type: 'motorizedhatch',
    version: '3.5',
    openDp: 1,
    closeDp: 2,
    openDurationMs: 1000,
    closeDurationMs: 1000,
    ...contextOverrides,
  } as any)
  device.connected = true

  const accessory = createMockPlatformAccessory(contextOverrides)

  const Characteristic = createMockCharacteristic() as any
  Characteristic.CurrentDoorState = { OPEN: 0, CLOSED: 1, OPENING: 2, CLOSING: 3, STOPPED: 4 }
  Characteristic.TargetDoorState = { OPEN: 0, CLOSED: 1 }
  Characteristic.ObstructionDetected = 'obstruction-detected'

  const Service = createMockService() as any
  Service.GarageDoorOpener = { UUID: 'garage-door-opener-uuid' }

  const platform = {
    log: createMockLogger(),
    api: { hap: { Characteristic, Service, Categories: createMockCategories() } },
    registerPlatformAccessories: vi.fn(),
  }

  const hatch = new MotorizedHatchAccessory(platform, accessory, device, false)

  return { hatch, device, accessory, platform, Characteristic, Service }
}

describe('MotorizedHatchAccessory', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the GARAGE_DOOR_OPENER category', () => {
    expect(MotorizedHatchAccessory.getCategory(createMockCategories())).toBe(4)
  })

  it('adds a GarageDoorOpener service on registration', () => {
    const { hatch, accessory, Service } = createHatch()
    hatch._registerPlatformAccessory()

    expect(accessory.addService).toHaveBeenCalledWith(Service.GarageDoorOpener, 'Dakluik')
  })

  it('initialises CurrentDoorState and TargetDoorState to CLOSED', () => {
    const { hatch, accessory, Service, Characteristic } = createHatch()
    hatch._registerPlatformAccessory()
    hatch._registerCharacteristics({})

    const service = accessory.getService(Service.GarageDoorOpener)!
    expect(service.getCharacteristic(Characteristic.CurrentDoorState).value).toBe(Characteristic.CurrentDoorState.CLOSED)
    expect(service.getCharacteristic(Characteristic.TargetDoorState).value).toBe(Characteristic.TargetDoorState.CLOSED)
  })

  it('drives the open relay and schedules auto-stop when target becomes OPEN', () => {
    const { hatch, device, accessory, Service, Characteristic } = createHatch({ openDurationMs: 1000 })
    hatch._registerPlatformAccessory()
    hatch._registerCharacteristics({})

    const service = accessory.getService(Service.GarageDoorOpener)!
    const target = service.getCharacteristic(Characteristic.TargetDoorState)
    const current = service.getCharacteristic(Characteristic.CurrentDoorState)

    const cb = vi.fn()
    target.emit('set', Characteristic.TargetDoorState.OPEN, cb)

    expect(cb).toHaveBeenCalledWith()
    expect(device.update).toHaveBeenCalledWith({ '2': false })
    expect(device.update).toHaveBeenCalledWith({ '1': true })
    expect(current.value).toBe(Characteristic.CurrentDoorState.OPENING)

    device.update.mockClear()
    vi.advanceTimersByTime(1000)

    expect(device.update).toHaveBeenCalledWith({ '1': false })
    expect(current.value).toBe(Characteristic.CurrentDoorState.OPEN)
  })

  it('drives the close relay when closing from a fully open state', () => {
    const {
      hatch,
      device,
      accessory,
      Service,
      Characteristic,
    } = createHatch({ openDurationMs: 1000, closeDurationMs: 1500 })
    hatch._registerPlatformAccessory()
    hatch._registerCharacteristics({})

    const service = accessory.getService(Service.GarageDoorOpener)!
    const target = service.getCharacteristic(Characteristic.TargetDoorState)
    const current = service.getCharacteristic(Characteristic.CurrentDoorState)

    target.emit('set', Characteristic.TargetDoorState.OPEN, vi.fn())
    vi.advanceTimersByTime(1000)
    expect(current.value).toBe(Characteristic.CurrentDoorState.OPEN)

    device.update.mockClear()
    target.emit('set', Characteristic.TargetDoorState.CLOSED, vi.fn())

    expect(device.update).toHaveBeenCalledWith({ '1': false })
    expect(device.update).toHaveBeenCalledWith({ '2': true })
    expect(current.value).toBe(Characteristic.CurrentDoorState.CLOSING)

    device.update.mockClear()
    vi.advanceTimersByTime(1500)

    expect(device.update).toHaveBeenCalledWith({ '2': false })
    expect(current.value).toBe(Characteristic.CurrentDoorState.CLOSED)
  })

  it('no-ops when asked to close while already fully closed', () => {
    const { hatch, device, accessory, Service, Characteristic } = createHatch()
    hatch._registerPlatformAccessory()
    hatch._registerCharacteristics({})

    const service = accessory.getService(Service.GarageDoorOpener)!
    const target = service.getCharacteristic(Characteristic.TargetDoorState)
    const current = service.getCharacteristic(Characteristic.CurrentDoorState)

    device.update.mockClear()
    target.emit('set', Characteristic.TargetDoorState.CLOSED, vi.fn())

    expect(device.update).not.toHaveBeenCalledWith({ '2': true })
    expect(current.value).toBe(Characteristic.CurrentDoorState.CLOSED)
  })

  it('reverses direction mid-motion without leaving the open relay energized', () => {
    const { hatch, device, accessory, Service, Characteristic } = createHatch({ openDurationMs: 1000 })
    hatch._registerPlatformAccessory()
    hatch._registerCharacteristics({})

    const service = accessory.getService(Service.GarageDoorOpener)!
    const target = service.getCharacteristic(Characteristic.TargetDoorState)
    const current = service.getCharacteristic(Characteristic.CurrentDoorState)

    target.emit('set', Characteristic.TargetDoorState.OPEN, vi.fn())
    vi.advanceTimersByTime(300)

    device.update.mockClear()
    target.emit('set', Characteristic.TargetDoorState.CLOSED, vi.fn())

    expect(device.update).toHaveBeenCalledWith({ '1': false })
    expect(device.update).toHaveBeenCalledWith({ '2': true })
    expect(current.value).toBe(Characteristic.CurrentDoorState.CLOSING)

    vi.advanceTimersByTime(2000)

    expect(current.value).toBe(Characteristic.CurrentDoorState.CLOSED)
  })

  it('closes only for the elapsed-open duration when reversing mid-travel', () => {
    const {
      hatch,
      device,
      accessory,
      Service,
      Characteristic,
    } = createHatch({ openDurationMs: 10000, closeDurationMs: 10000 })
    hatch._registerPlatformAccessory()
    hatch._registerCharacteristics({})

    const service = accessory.getService(Service.GarageDoorOpener)!
    const target = service.getCharacteristic(Characteristic.TargetDoorState)
    const current = service.getCharacteristic(Characteristic.CurrentDoorState)

    target.emit('set', Characteristic.TargetDoorState.OPEN, vi.fn())
    vi.advanceTimersByTime(2000)

    target.emit('set', Characteristic.TargetDoorState.CLOSED, vi.fn())
    device.update.mockClear()

    // After 1999 ms the motor should still be running (total close time ≈ 2000 ms)
    vi.advanceTimersByTime(1999)
    expect(current.value).toBe(Characteristic.CurrentDoorState.CLOSING)
    expect(device.update).not.toHaveBeenCalledWith({ '2': false })

    vi.advanceTimersByTime(10)
    expect(device.update).toHaveBeenCalledWith({ '2': false })
    expect(current.value).toBe(Characteristic.CurrentDoorState.CLOSED)
  })

  it('honours custom openDp and closeDp config', () => {
    const { hatch, device, accessory, Service, Characteristic } = createHatch({ openDp: 5, closeDp: 6 })
    hatch._registerPlatformAccessory()
    hatch._registerCharacteristics({})

    const service = accessory.getService(Service.GarageDoorOpener)!
    const target = service.getCharacteristic(Characteristic.TargetDoorState)

    target.emit('set', Characteristic.TargetDoorState.OPEN, vi.fn())

    expect(device.update).toHaveBeenCalledWith({ '6': false })
    expect(device.update).toHaveBeenCalledWith({ '5': true })
  })
})
