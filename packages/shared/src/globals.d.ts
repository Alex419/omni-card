// structuredClone exists in every runtime we target (Node 17+, all modern browsers) but lives in
// the DOM and Node type packages. Declare it here so this package depends on neither.
declare function structuredClone<T>(value: T): T;
