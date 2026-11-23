import { createUiDesign, patchUiDesign, uiDesignVersion } from "../../src/ui-design.js";

export const designOperations = (...operations: unknown[]) =>
    [...operations, { op: "done" }].map(operation => JSON.stringify(operation)).join("\n");

export const designReferences = ["brief-booking", "brief-profile"];
export const designOutline = designOperations(
    ...["workshops", "booking", "profile"].map((id, index) => ({
        op: "upsert-screen", screen: {
            id, title: ["Find a workshop", "Book your place", "Your profile"][index],
            purpose: ["Browse upcoming workshops", "Choose a workshop and provide attendee details", "Review contact details"][index],
            decisionIds: [id === "profile" ? "brief-profile" : "brief-booking"],
            width: 960, height: 640, notes: id === "workshops" ? "Sold-out workshops show availability, without a booking action." : "",
        },
    })),
    { op: "upsert-transition", transition: { id: "book-place", fromScreenId: "workshops", toScreenId: "booking", trigger: "Book a place", description: "Preview the booking screen only." } },
    { op: "upsert-transition", transition: { id: "back-to-workshops", fromScreenId: "booking", toScreenId: "workshops", trigger: "Back to workshops", description: "" } },
);
export const designContents = designOperations(
    ...["workshops", "booking", "profile"].flatMap((screenId, index) => [
        { op: "ui", screenId, edit: { op: "add", parent: "screen", component: {
            id: "title", type: "Heading", props: { text: ["Find your next workshop", "Book your place", "Your contact details"][index] },
        } } },
        { op: "ui", screenId, edit: { op: "add", parent: "screen", component: {
            id: "details", type: "Text", props: { text: ["Pottery basics - Saturday, 10:00 - 6 places available", "Pottery basics - one attendee", "Choose the details used for workshop bookings."][index] },
        } } },
    ]),
    { op: "ui", screenId: "workshops", edit: { op: "add", parent: "screen", component: { id: "book", type: "Button", props: { label: "Book a place", action: "book-place" } } } },
    { op: "ui", screenId: "booking", edit: { op: "add", parent: "screen", component: { id: "name", type: "Input", props: { label: "Attendee name", value: "Sample attendee" } } } },
    { op: "ui", screenId: "booking", edit: { op: "add", parent: "screen", component: { id: "submit", type: "Button", props: { label: "Request a place" } } } },
);

export const uiDesignOutline = () => createUiDesign("example", designReferences, designOutline);
export function uiDesignFixture() {
    const outline = uiDesignOutline();
    return patchUiDesign(outline, uiDesignVersion(outline), designContents, "content");
}
