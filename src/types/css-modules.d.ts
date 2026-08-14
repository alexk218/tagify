declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '*.module.css?inline' {
  const cssText: string;
  export default cssText;
}

declare module '*.module.scss' {
  const classes: { [key: string]: string };
  export default classes;
}
