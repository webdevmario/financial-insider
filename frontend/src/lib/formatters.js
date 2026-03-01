/** Format number as currency, compact for large values */
export function fmt(n) {
    if (n == null || isNaN(n))
        return "$0";
    const a = Math.abs(n);
    const s = a >= 1000
        ? a.toLocaleString("en-US", { maximumFractionDigits: 0 })
        : a.toFixed(2);
    return (n < 0 ? "-$" : "$") + s;
}
/** Format number as currency with 2 decimal places */
export function fmtP(n) {
    if (n == null || isNaN(n))
        return "$0.00";
    return ((n < 0 ? "-$" : "$") +
        Math.abs(n).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }));
}
/** Format YYYY-MM-DD as "Jan 1, 2026" */
export function fmtDate(ds) {
    if (!ds)
        return "";
    try {
        const [y, m, d] = ds.split("-").map(Number);
        const months = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ];
        return `${months[m - 1]} ${d}, ${y}`;
    }
    catch {
        return ds;
    }
}
/** Get current month as YYYY-MM */
export function curMo() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
/** Format YYYY-MM as "Mar 2026" */
export function moLabel(ym) {
    const [y, m] = ym.split("-");
    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${months[parseInt(m) - 1]} ${y}`;
}
/** Today's date as YYYY-MM-DD */
export function today() {
    return new Date().toISOString().slice(0, 10);
}
