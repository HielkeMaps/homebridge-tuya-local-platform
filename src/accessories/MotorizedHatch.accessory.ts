import BaseAccessory from './Base.accessory'
import type { DPSState, HomebridgeCallback } from '../types'

class MotorizedHatchAccessory extends BaseAccessory {
  static getCategory(Categories: any): number {
    return Categories.GARAGE_DOOR_OPENER
  }

  private _openDp!: string
  private _closeDp!: string
  private _openDurationMs!: number
  private _closeDurationMs!: number

  private _currentDoorChar!: any
  private _targetDoorChar!: any
  private _runTimer: ReturnType<typeof setTimeout> | null = null

  // 0 = fully closed, 1 = fully open. Synthesized — no device feedback.
  private _position = 0
  private _motionDirection: 'open' | 'close' | null = null
  private _motionStartTime = 0

  constructor(...props: any[]) {
    super(...props)
  }

  _registerPlatformAccessory(): void {
    const { Service } = this.hap
    this.accessory.addService(Service.GarageDoorOpener, this.device.context.name)
    super._registerPlatformAccessory()
  }

  _registerCharacteristics(_dps: DPSState): void {
    const { Service, Characteristic } = this.hap
    const service = this.accessory.getService(Service.GarageDoorOpener)!
    this._checkServiceName(service, this.device.context.name)

    const ctx = this.device.context as Record<string, unknown>
    this._openDp = String(parseInt(ctx.openDp as string) || 1)
    this._closeDp = String(parseInt(ctx.closeDp as string) || 2)
    this._openDurationMs = Math.max(1000, parseInt(ctx.openDurationMs as string) || 30000)
    this._closeDurationMs = Math.max(1000, parseInt(ctx.closeDurationMs as string) || this._openDurationMs)

    this._currentDoorChar = service
      .getCharacteristic(Characteristic.CurrentDoorState)
      .updateValue(Characteristic.CurrentDoorState.CLOSED)

    this._targetDoorChar = service
      .getCharacteristic(Characteristic.TargetDoorState)
      .updateValue(Characteristic.TargetDoorState.CLOSED)
      .on('set', this._onSetTarget.bind(this))

    service
      .getCharacteristic(Characteristic.ObstructionDetected)
      .updateValue(false)
      .on('get', (cb: HomebridgeCallback) => cb(null, false))
  }

  _onSetTarget(value: any, callback: HomebridgeCallback): void {
    const { Characteristic } = this.hap

    if (value === Characteristic.TargetDoorState.OPEN) {
      this._drive('open')
    } else {
      this._drive('close')
    }

    callback()
  }

  private _drive(direction: 'open' | 'close'): void {
    const { Characteristic } = this.hap

    const now = Date.now()
    this._freezePosition(now)

    if (this._runTimer) {
      clearTimeout(this._runTimer)
      this._runTimer = null
    }

    const atTarget = direction === 'open' ? this._position >= 1 : this._position <= 0
    if (atTarget) {
      this.setMultiState({ [this._openDp]: false, [this._closeDp]: false })
      this._currentDoorChar.updateValue(
        direction === 'open' ? Characteristic.CurrentDoorState.OPEN : Characteristic.CurrentDoorState.CLOSED,
      )
      return
    }

    const activeDp = direction === 'open' ? this._openDp : this._closeDp
    const oppositeDp = direction === 'open' ? this._closeDp : this._openDp
    const remaining =
      direction === 'open' ? (1 - this._position) * this._openDurationMs : this._position * this._closeDurationMs

    this.setMultiState({ [oppositeDp]: false, [activeDp]: true })

    this._currentDoorChar.updateValue(
      direction === 'open' ? Characteristic.CurrentDoorState.OPENING : Characteristic.CurrentDoorState.CLOSING,
    )

    this._motionDirection = direction
    this._motionStartTime = now

    this._runTimer = setTimeout(() => {
      this._runTimer = null
      this._freezePosition(Date.now())
      this.setState(activeDp, false)
      this._currentDoorChar.updateValue(
        direction === 'open' ? Characteristic.CurrentDoorState.OPEN : Characteristic.CurrentDoorState.CLOSED,
      )
    }, remaining)
  }

  private _freezePosition(now: number): void {
    if (!this._motionDirection) return

    const elapsed = now - this._motionStartTime
    const duration = this._motionDirection === 'open' ? this._openDurationMs : this._closeDurationMs
    const delta = Math.min(1, Math.max(0, elapsed / duration))

    if (this._motionDirection === 'open') {
      this._position = Math.min(1, this._position + delta)
    } else {
      this._position = Math.max(0, this._position - delta)
    }

    this._motionDirection = null
  }
}

export default MotorizedHatchAccessory
