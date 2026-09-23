// Only the cassette recorder touches the filesystem, and the page never records.
const unavailable = () => {
  throw new Error("no filesystem in a browser");
};
export const existsSync = () => false;
export const mkdirSync = unavailable;
export const readFileSync = unavailable;
export const writeFileSync = unavailable;
export const realpathSync = unavailable;
