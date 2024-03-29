(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.textot = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const unicount_1 = require("unicount");
function api(getSnapshot, submitOp) {
    return {
        // Returns the text content of the document
        get: getSnapshot,
        // Returns the number of characters in the string
        getLength() { return getSnapshot().length; },
        // Insert the specified text at the given position in the document
        insert(pos, text, callback) {
            const uniPos = unicount_1.strPosToUni(getSnapshot(), pos);
            return submitOp([uniPos, text], callback);
        },
        remove(pos, length, callback) {
            const uniPos = unicount_1.strPosToUni(getSnapshot(), pos);
            return submitOp([uniPos, { d: length }], callback);
        },
        // When you use this API, you should implement these two methods
        // in your editing context.
        //onInsert: function(pos, text) {},
        //onRemove: function(pos, removedLength) {},
        _onOp(op) {
            var pos = 0;
            var spos = 0;
            for (var i = 0; i < op.length; i++) {
                var component = op[i];
                switch (typeof component) {
                    case 'number':
                        pos += component;
                        spos += component;
                        break;
                    case 'string':
                        if (this.onInsert)
                            this.onInsert(pos, component);
                        pos += component.length;
                        break;
                    case 'object':
                        if (this.onRemove)
                            this.onRemove(pos, component.d);
                        spos += component.d;
                }
            }
        },
        onInsert: null,
        onRemove: null,
    };
}
exports.default = api;
// This triggers a bug in the typescript compiler, where it generates an
// invalid typescript declaration file.
//api.provides = {text: true}
;
api.provides = { text: true };

},{"unicount":3}],2:[function(require,module,exports){
"use strict";
/* Text OT!
 *
 * This is an OT implementation for text. It is the standard implementation of
 * text used by ShareJS.
 *
 * This type is composable but non-invertable. Its similar to ShareJS's old
 * text-composable type, but its not invertable and its very similar to the
 * text-tp2 implementation but it doesn't support tombstones or purging.
 *
 * Ops are lists of components which iterate over the document. Components are
 * either: A number N: Skip N characters in the original document "str" :
 * Insert "str" at the current position in the document {d:N} : Delete N
 * characters at the current position in the document
 *
 * Eg: [3, 'hi', 5, {d:8}]
 *
 * The operation does not have to skip the last characters in the document.
 *
 * Snapshots are strings.
 *
 * Cursors are either a single number (which is the cursor position) or a pair
 * of [anchor, focus] (aka [start, end]). Be aware that end can be before
 * start.
 *
 * The actual string type is configurable. The OG default exposed text type
 * uses raw javascript strings, but they're not compatible with OT
 * implementations in other languages because string.length returns the wrong
 * value for unicode characters that don't fit in 2 bytes. And JS strings are
 * quite an inefficient data structure for manipulating lines & UTF8 offsets.
 * For this reason, you can use your own data structure underneath the text OT
 * code.
 *
 * Note that insert operations themselves are always raw strings. Its just
 * snapshots that are configurable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const unicount_1 = require("unicount");
/** Check the operation is valid. Throws if not valid. */
const checkOp = (op) => {
    if (!Array.isArray(op))
        throw Error('Op must be an array of components');
    let last = null;
    for (let i = 0; i < op.length; i++) {
        const c = op[i];
        switch (typeof c) {
            case 'object':
                // The only valid objects are {d:X} for +ive values of X.
                if (!(typeof c.d === 'number' && c.d > 0))
                    throw Error('Object components must be deletes of size > 0');
                break;
            case 'string':
                // Strings are inserts.
                if (!(c.length > 0))
                    throw Error('Inserts cannot be empty');
                break;
            case 'number':
                // Numbers must be skips. They have to be +ive numbers.
                if (!(c > 0))
                    throw Error('Skip components must be >0');
                if (typeof last === 'number')
                    throw Error('Adjacent skip components should be combined');
                break;
        }
        last = c;
    }
    if (typeof last === 'number')
        throw Error('Op has a trailing skip');
};
const normalize = (op) => {
    const newOp = [];
    const append = makeAppend(newOp);
    for (let i = 0; i < op.length; i++)
        append(op[i]);
    return trim(newOp);
};
/** Check that the given selection range is valid. */
const checkSelection = (selection) => {
    // This may throw from simply inspecting selection[0] / selection[1]. Thats
    // sort of ok, though it'll generate the wrong message.
    if (typeof selection !== 'number'
        && (typeof selection[0] !== 'number' || typeof selection[1] !== 'number')) {
        throw Error('Invalid selection');
    }
};
/** Make a function that appends to the given operation. */
const makeAppend = (op) => (component) => {
    if (!component || component.d === 0) {
        // The component is a no-op. Ignore!
    }
    else if (op.length === 0) {
        op.push(component);
    }
    else if (typeof component === typeof op[op.length - 1]) {
        if (typeof component === 'object') {
            // Concatenate deletes
            op[op.length - 1].d += component.d;
        }
        else {
            // Concat strings / inserts. TSC should be smart enough for this :p
            op[op.length - 1] += component;
        }
    }
    else {
        op.push(component);
    }
};
/** Get the length of a component */
const componentLength = (c) => (typeof c === 'number' ? c
    : typeof c === 'string' ? unicount_1.strPosToUni(c)
        : c.d);
/** Makes and returns utility functions take and peek.
 */
const makeTake = (op) => {
    // TODO: Rewrite this by passing a context, like the rust code does. Its cleaner that way.
    // The index of the next component to take
    let idx = 0;
    // The offset into the component. For strings this is in UCS2 length, not
    // unicode codepoints.
    let offset = 0;
    // Take up to length n from the front of op. If n is -1, take the entire next
    // op component. If indivisableField == 'd', delete components won't be separated.
    // If indivisableField == 'i', insert components won't be separated.
    const take = (n, indivisableField) => {
        // We're at the end of the operation. The op has skips, forever. Infinity
        // might make more sense than null here.
        if (idx === op.length)
            return n === -1 ? null : n;
        const c = op[idx];
        let part;
        if (typeof c === 'number') {
            // Skip
            if (n === -1 || c - offset <= n) {
                part = c - offset;
                ++idx;
                offset = 0;
                return part;
            }
            else {
                offset += n;
                return n;
            }
        }
        else if (typeof c === 'string') {
            // Insert
            if (n === -1 || indivisableField === 'i' || unicount_1.strPosToUni(c.slice(offset)) <= n) {
                part = c.slice(offset);
                ++idx;
                offset = 0;
                return part;
            }
            else {
                const offset2 = offset + unicount_1.uniToStrPos(c.slice(offset), n);
                part = c.slice(offset, offset2);
                offset = offset2;
                return part;
            }
        }
        else {
            // Delete
            if (n === -1 || indivisableField === 'd' || c.d - offset <= n) {
                part = { d: c.d - offset };
                ++idx;
                offset = 0;
                return part;
            }
            else {
                offset += n;
                return { d: n };
            }
        }
    };
    // Peek at the next op that will be returned.
    const peek = () => op[idx];
    return { take, peek };
};
/** Trim any excess skips from the end of an operation.
 *
 * There should only be at most one, because the operation was made with append.
 */
const trim = (op) => {
    if (op.length > 0 && typeof op[op.length - 1] === 'number') {
        op.pop();
    }
    return op;
};
/** Transform op by otherOp.
 *
 * @param op - The operation to transform
 * @param otherOp - Operation to transform it by
 * @param side - Either 'left' or 'right'
 */
function transform(op1, op2, side) {
    if (side !== 'left' && side !== 'right') {
        throw Error("side (" + side + ") must be 'left' or 'right'");
    }
    checkOp(op1);
    checkOp(op2);
    const newOp = [];
    const append = makeAppend(newOp);
    const { take, peek } = makeTake(op1);
    for (let i = 0; i < op2.length; i++) {
        const c2 = op2[i];
        let length, c1;
        switch (typeof c2) {
            case 'number': // Skip
                length = c2;
                while (length > 0) {
                    c1 = take(length, 'i');
                    append(c1);
                    if (typeof c1 !== 'string') {
                        length -= componentLength(c1);
                    }
                }
                break;
            case 'string': // Insert
                if (side === 'left') {
                    // The left insert should go first.
                    if (typeof peek() === 'string') {
                        append(take(-1));
                    }
                }
                // Otherwise skip the inserted text.
                append(unicount_1.strPosToUni(c2));
                break;
            case 'object': // Delete
                length = c2.d;
                while (length > 0) {
                    c1 = take(length, 'i');
                    switch (typeof c1) {
                        case 'number':
                            length -= c1;
                            break;
                        case 'string':
                            append(c1);
                            break;
                        case 'object':
                            // The delete is unnecessary now - the text has already been deleted.
                            length -= c1.d;
                    }
                }
                break;
        }
    }
    // Append any extra data in op1.
    let c;
    while ((c = take(-1)))
        append(c);
    return trim(newOp);
}
/** Compose op1 and op2 together and return the result */
function compose(op1, op2) {
    checkOp(op1);
    checkOp(op2);
    const result = [];
    const append = makeAppend(result);
    const { take } = makeTake(op1);
    for (let i = 0; i < op2.length; i++) {
        const component = op2[i];
        let length, chunk;
        switch (typeof component) {
            case 'number': // Skip
                length = component;
                while (length > 0) {
                    chunk = take(length, 'd');
                    append(chunk);
                    if (typeof chunk !== 'object') {
                        length -= componentLength(chunk);
                    }
                }
                break;
            case 'string': // Insert
                append(component);
                break;
            case 'object': // Delete
                length = component.d;
                while (length > 0) {
                    chunk = take(length, 'd');
                    switch (typeof chunk) {
                        case 'number':
                            append({ d: chunk });
                            length -= chunk;
                            break;
                        case 'string':
                            length -= unicount_1.strPosToUni(chunk);
                            break;
                        case 'object':
                            append(chunk);
                    }
                }
                break;
        }
    }
    let c;
    while ((c = take(-1)))
        append(c);
    return trim(result);
}
// This operates in unicode offsets to make it consistent with the equivalent
// methods in other languages / systems.
const transformPosition = (cursor, op) => {
    let pos = 0;
    for (let i = 0; i < op.length && cursor > pos; i++) {
        const c = op[i];
        // I could actually use the op_iter stuff above - but I think its simpler
        // like this.
        switch (typeof c) {
            case 'number': { // skip
                pos += c;
                break;
            }
            case 'string': // insert
                // Its safe to use c.length here because they're both utf16 offsets.
                // Ignoring pos because the doc doesn't know about the insert yet.
                const offset = unicount_1.strPosToUni(c);
                pos += offset;
                cursor += offset;
                break;
            case 'object': // delete
                cursor -= Math.min(c.d, cursor - pos);
                break;
        }
    }
    return cursor;
};
const transformSelection = (selection, op) => (typeof selection === 'number'
    ? transformPosition(selection, op)
    : selection.map(s => transformPosition(s, op)));
function makeType(ropeImpl) {
    return {
        name: 'text-unicode',
        uri: 'http://sharejs.org/types/text-unicode',
        trim,
        normalize,
        checkOp,
        /** Create a new text snapshot.
         *
         * @param {string} initial - initial snapshot data. Optional. Defaults to ''.
         * @returns {Snap} Initial document snapshot object
         */
        create(initial = '') {
            if (typeof initial !== 'string') {
                throw Error('Initial data must be a string');
            }
            return ropeImpl.create(initial);
        },
        /** Apply an operation to a document snapshot
         */
        apply(str, op) {
            checkOp(op);
            const builder = ropeImpl.builder(str);
            for (let i = 0; i < op.length; i++) {
                const component = op[i];
                switch (typeof component) {
                    case 'number':
                        builder.skip(component);
                        break;
                    case 'string':
                        builder.append(component);
                        break;
                    case 'object':
                        builder.del(component.d);
                        break;
                }
            }
            return builder.build();
        },
        transform,
        compose,
        transformPosition,
        transformSelection,
    };
}
exports.default = makeType;

},{"unicount":3}],3:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.strPosToUni = (s, strOffset = s.length) => {
    let pairs = 0;
    let i = 0;
    for (; i < strOffset; i++) {
        const code = s.charCodeAt(i);
        if (code >= 0xd800) {
            pairs++;
            i++; // Skip the second part of the pair.
        }
    }
    if (i !== strOffset)
        throw Error('Invalid offset - splits unicode bytes');
    return i - pairs;
};
exports.uniToStrPos = (s, uniOffset) => {
    let pos = 0;
    for (; uniOffset > 0; uniOffset--) {
        const code = s.charCodeAt(pos);
        pos += code >= 0xd800 ? 2 : 1;
    }
    return pos;
};

},{}],"ot-text-unicode":[function(require,module,exports){
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// This is an implementation of the text OT type built on top of JS strings.
// You would think this would be horribly inefficient, but its surpringly
// good. JS strings are magic.
const unicount_1 = require("unicount");
const maketext_1 = __importDefault(require("./maketext"));
const api_1 = __importDefault(require("./api"));
const ropeImplUnicodeString = {
    create(s) { return s; },
    toString(s) { return s; },
    builder(oldDoc) {
        if (typeof oldDoc !== 'string')
            throw Error('Invalid document snapshot: ' + oldDoc);
        const newDoc = [];
        return {
            skip(n) {
                let offset = unicount_1.uniToStrPos(oldDoc, n);
                if (offset > oldDoc.length)
                    throw Error('The op is too long for this document');
                newDoc.push(oldDoc.slice(0, offset));
                oldDoc = oldDoc.slice(offset);
            },
            append(s) {
                newDoc.push(s);
            },
            del(n) {
                oldDoc = oldDoc.slice(unicount_1.uniToStrPos(oldDoc, n));
            },
            build() { return newDoc.join('') + oldDoc; },
        };
    }
};
const textString = maketext_1.default(ropeImplUnicodeString);
const type = Object.assign({}, textString, { api: api_1.default });
exports.type = type;
var maketext_2 = require("./maketext");
exports.makeType = maketext_2.default;

},{"./api":1,"./maketext":2,"unicount":3}]},{},[])("ot-text-unicode")
});
