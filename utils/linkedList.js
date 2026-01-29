"use strict";

class Node {
    constructor(state, meta) {
        this.state = state;
        this.meta = meta;
        this.timestamp = Date.now();
        this.next = null;
        this.prev = null;
    }
}

class StateLedger {
    constructor(capacity = 20) {
        this.head = null;
        this.tail = null;
        this.size = 0;
        this.capacity = capacity;
    }

    push(state, meta) {
        const node = new Node(state, meta);
        if (!this.head) {
            this.head = this.tail = node;
        } else {
            node.prev = this.tail;
            this.tail.next = node;
            this.tail = node;
        }
        this.size++;
        if (this.size > this.capacity) this.shift();
    }

    shift() {
        if (!this.head) return;
        this.head = this.head.next;
        if (this.head) this.head.prev = null;
        this.size--;
    }

    last() { return this.tail ? this.tail.state : "OFFLINE"; }
}

module.exports = StateLedger;