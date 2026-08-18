"use strict";

/**
 * A professional-grade O(1) Queue implementation.
 * Uses a circular buffer to prevent memory fragmentation and O(n) shift overhead.
 */
class FastQueue {
    constructor(initialCapacity = 1024) {
        this._capacity = initialCapacity;
        this._items = new Array(this._capacity);
        this._head = 0;
        this._tail = 0;
        this._size = 0;
    }

    get length() {
        return this._size;
    }

    push(value) {
        if (this._size === this._capacity) {
            this._resize(this._capacity * 2);
        }
        this._items[this._tail] = value;
        this._tail = (this._tail + 1) % this._capacity;
        this._size++;
    }

    shift() {
        if (this._size === 0) return undefined;
        const value = this._items[this._head];
        this._items[this._head] = undefined; // Avoid memory leaks (GC can reclaim)
        this._head = (this._head + 1) % this._capacity;
        this._size--;

        // Optional: Shrink if only 25% full (prevent massive idle memory)
        if (this._size > 1024 && this._size < this._capacity / 4) {
            this._resize(this._capacity / 2);
        }
        return value;
    }

    peek() {
        return this._size > 0 ? this._items[this._head] : undefined;
    }

    clear() {
        this._items = new Array(this._capacity);
        this._head = 0;
        this._tail = 0;
        this._size = 0;
    }

    _resize(newCapacity) {
        const newItems = new Array(newCapacity);
        for (let i = 0; i < this._size; i++) {
            newItems[i] = this._items[(this._head + i) % this._capacity];
        }
        this._items = newItems;
        this._capacity = newCapacity;
        this._head = 0;
        this._tail = this._size;
    }
}

module.exports = FastQueue;