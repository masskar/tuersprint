import {CubeProvider} from "@variocube/cube-app-react-sdk";
import {createRoot} from "react-dom/client";
import {App} from "./App.tsx";
import "./style.css";

createRoot(document.getElementById("root")!).render(
	<CubeProvider>
		<App />
	</CubeProvider>,
);
