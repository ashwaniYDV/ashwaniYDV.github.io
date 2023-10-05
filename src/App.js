import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./Home/Home";
import Journal from "./Journal/Journal";


function App() {
	return (
		<BrowserRouter>
			<Routes>
			<Route path="/journal" element={<Journal />}></Route>
				<Route path="/*" element={<Home />}></Route>
			</Routes>
		</BrowserRouter>
	);
}

export default App;
