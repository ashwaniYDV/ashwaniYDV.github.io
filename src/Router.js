import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Home from "./Home/Home";
import Journal from "./Journal/Journal";

const router = createBrowserRouter([
    {
        path: "/journal",
        element: <Journal />,
    },
    {
        path: "/",
        element: <Home />,
    },
]);

export default router;