declare module "*.css" {
    const content: string;
    export default content;
}

declare module "*.css?inline" {
    const content: string;
    export default content;
}

declare module "*.html" {
    const content: string;
    export default content;
}

declare module "*.png" {
    const url: string;
    export default url;
}

declare module "tandem:client" {
    const content: string;
    export default content;
}

declare module "tandem:styles" {
    const content: string;
    export default content;
}

declare module "tandem:browser-client" {
    const content: string;
    export default content;
}

declare module "tandem:browser-styles" {
    const content: string;
    export default content;
}
