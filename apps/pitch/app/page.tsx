/**
 * The one route this site has.
 *
 * It re-exports the product's own pitch page rather than copying it, so the
 * cards, the graph palette and the scrollytelling here are literally the same
 * code that runs at /pitch inside the app.
 */
export { default } from "@/app/pitch/page";
