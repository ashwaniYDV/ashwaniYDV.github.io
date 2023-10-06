import { BrowserRouter, Route, Routes } from "react-router-dom";
import React from "react";
import Journal from "./Journal/Journal";
import Home from "./Home/Home";


function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route exact path="/journal" element={<Journal />}></Route>
				<Route path="/*" element={<Home />}></Route>
			</Routes>
		</BrowserRouter>
	);
}

export default App;
