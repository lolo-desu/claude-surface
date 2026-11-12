// Own only attributes we actually apply. A native/third-party edit becomes the
// next restore value, and disabling restores once instead of replaying forever.
export function createAttributeOwner() {
    const records = new Map();
    const write = (element, name, value) => value == null ? element.removeAttribute(name) : element.setAttribute(name, value);
    const release = (element, attributes) => {
        for (const [name, record] of attributes) {
            if (element.getAttribute(name) === record.applied && record.original !== record.applied) write(element, name, record.original);
        }
        records.delete(element);
    };
    return {
        prune() {
            for (const [element, attributes] of records) if (!element.isConnected) release(element, attributes);
        },
        apply(element, values) {
            if (!element) return;
            if (!records.has(element)) records.set(element, new Map());
            const attributes = records.get(element);
            for (const [name, raw] of Object.entries(values)) {
                const value = raw == null ? null : String(raw), current = element.getAttribute(name);
                let record = attributes.get(name);
                if (!record) { record = { original: current, applied: current }; attributes.set(name, record); }
                else if (current !== record.applied) record.original = current;
                if (current !== value) write(element, name, value);
                record.applied = value;
            }
        },
        restore() {
            for (const [element, attributes] of records) release(element, attributes);
        },
    };
}
