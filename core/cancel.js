'use strict';

// Cancellation token: cho phep DUNG NGAY task dang chay (khong cho chay xong).
// Worker giu 1 token cho moi luot; stop() goi cancel(). Cac thao tac device va sleep
// kiem tra token va nem CancelError de unwind task ngay lap tuc.

class CancelError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelError';
    this.cancelled = true;
  }
}

class CancelToken {
  constructor() {
    this._cancelled = false;
  }

  get cancelled() {
    return this._cancelled;
  }

  cancel() {
    this._cancelled = true;
  }

  // Nem CancelError neu da bi huy.
  check() {
    if (this._cancelled) throw new CancelError();
  }
}

module.exports = { CancelError, CancelToken };
