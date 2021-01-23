import "./styles.css";

const pad = document.getElementById("pad");
let socket = null;
let touchHandler = null;

const moveBuf = new Uint8Array([1, 0, 0, 0, 0]);
const scrollXBuf = new Uint8Array([5, 0, 0]);
const scrollYBuf = new Uint8Array([6, 0, 0]);
const downBuf = new Uint8Array([2, 0]);
const upBuf = new Uint8Array([3, 0]);

const RETRY_DELAY = 1000;
const JITTER_DELAY = 50;
const MOVE_SCALE = 1.8;
const SCROLL_SCALE = 0.5;
const FORCE_THRESHOLD = 0.25;

function copyInt16(buffer, index, integer) {
    buffer[index] = integer & 0xFF;
    buffer[index + 1] = (integer >> 8) & 0xFF;
}

function mouseMove(changeX, changeY) {
    changeX = Math.round(changeX * MOVE_SCALE);
    changeY = Math.round(changeY * MOVE_SCALE);
    copyInt16(moveBuf, 1, changeX);
    copyInt16(moveBuf, 3, changeY);
    socket.send(moveBuf);
}

function scaleNonZero(num, scale) {
    if (num > 0) {
        return Math.round(Math.max(1, num * scale));
    } else if (num < 0) {
        return Math.round(Math.min(-1, num * scale));
    } else {
        return 0;
    }
}

function mouseScroll(changeX, changeY) {
    if (changeX !== 0) {
        changeX = scaleNonZero(changeX, SCROLL_SCALE);
        copyInt16(scrollXBuf, 1, changeX);
        socket.send(scrollXBuf);
    }
    if (changeY !== 0) {
        changeY = scaleNonZero(changeY, SCROLL_SCALE);
        copyInt16(scrollYBuf, 1, changeY);
        socket.send(scrollYBuf);
    }
}

class TouchHandler {
    constructor() {
        this.touches = [];
        this.down = false;
    }

    static copyTouch(touch) {
        return {
            id: touch.identifier,
            x: touch.clientX,
            y: touch.clientY,
            force: touch.force
        };
    }

    static mouseMove(from, to) {
        mouseMove(to.clientX - from.x, to.clientY - from.y);
    }

    static updatePos(from, to) {
        from.x = to.clientX;
        from.y = to.clientY;
    }

    mouseUp() {
        this.down = false;
        socket.send(upBuf);
        pad.classList.remove("down");
    }

    mouseDown() {
        this.down = true;
        socket.send(downBuf);
        pad.classList.add("down");
    }

    findIndex(id) {
        return this.touches.findIndex(touch => {
            return touch.id === id;
        });
    }

    find(id) {
        return this.touches.find(touch => {
            return touch.id === id;
        });
    }

    getAvgPos() {
        const pos = {x: 0, y: 0};
        for (const touch of this.touches) {
            pos.x += touch.x;
            pos.y += touch.y;
        }
        pos.x /= this.touches.length;
        pos.y /= this.touches.length;
        return pos;
    }

    start(e) {
        for (const touch of e.changedTouches) {
            this.touches.push(TouchHandler.copyTouch(touch));
        }
    }

    move(e) {
        if (this.touches.length === 1) {
            TouchHandler.mouseMove(this.touches[0], e.changedTouches[0]);
            TouchHandler.updatePos(this.touches[0], e.changedTouches[0]);
        } else if (this.touches.length === 2) {
            const posBefore = this.getAvgPos();
            for (const touch of e.changedTouches) {
                TouchHandler.updatePos(this.find(touch.identifier), touch);
            }
            const posAfter = this.getAvgPos();
            mouseScroll(posBefore.x - posAfter.x, posBefore.y - posAfter.y);
        } else {
            for (const touch of e.changedTouches) {
                TouchHandler.updatePos(this.find(touch.identifier), touch);
            }
        }
    }

    end(e) {
        if (this.touches.length === 1) {
            TouchHandler.mouseMove(this.touches[0], e.changedTouches[0]);
            this.touches.splice(0, 1);
            if (this.down) {
                this.mouseUp();
            }
        } else {
            this.cancel(e);
        }
    }

    cancel(e) {
        for (const touch of e.changedTouches) {
            this.touches.splice(this.findIndex(touch.identifier), 1);
        }
        if (this.down) {
            this.mouseUp();
        }
    }

    forceChange(e) {
        if (this.touches.length === 1) {
            const force = e.changedTouches[0].force;
            this.touches[0].force = force;
            if (this.down) {
                if (force < FORCE_THRESHOLD) {
                    this.mouseUp();
                }
            } else {
                if (force >= FORCE_THRESHOLD) {
                    this.mouseDown();
                }
            }
        }
    }
}

function initialize() {
    touchHandler = new TouchHandler();

    pad.ontouchstart = e => {
        touchHandler.start(e);
        return false;
    };

    pad.ontouchmove = e => {
        touchHandler.move(e);
        return false;
    };

    pad.ontouchend = e => {
        touchHandler.end(e);
        return false;
    };

    pad.ontouchcancel = e => {
        touchHandler.cancel(e);
        return false;
    };

    pad.ontouchforcechange = e => {
        touchHandler.forceChange(e);
        return false;
    };
}

function connect() {
    socket = new WebSocket(`ws://${location.host}/socket`);
    socket.onopen = () => {
        pad.classList.remove("offline");
    };
    socket.onclose = e => {
        pad.classList.add("offline");
        if (e.code !== 1000) {
            setTimeout(connect, RETRY_DELAY);
        }
    };
}

connect();
initialize();

// This massively reduces jitter
const buf = new ArrayBuffer(0);
setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(buf);
    }
}, JITTER_DELAY);
