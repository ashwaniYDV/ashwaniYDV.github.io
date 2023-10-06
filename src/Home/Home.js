import Intro from "../Intro";
import Projects from "./Projects";
import Worked from "./Worked";
import AboutMe from "./AboutMe";
import AlmaMater from "./AlmaMater";
import Banner from "./Banner";
import Footer from "./Footer";
import HeaderAndNav from "./HeaderAndNav";

function Home() {
	return (
		<div class="page-wrapper">
			<HeaderAndNav />
			<Banner />

			<section id="wrapper">

				<span id="intro"></span>
				<Intro />

				<br />
				<span id="worked"></span>
				<h1 style={{ fontSize: "3em", textAlign: "center" }} className="myfont">Worked</h1>
				<br />
				<Worked />

				<br />
				<span id="alma-mater"></span>
				<h1 style={{ fontSize: "3em", textAlign: "center" }} className="myfont">Alma mater</h1>
				<br />
				<AlmaMater />

				<br />
				<span id="projects"></span>
				<h1 style={{ fontSize: "3em", textAlign: "center" }} className="myfont">Projects</h1>
				<br />
				<Projects />

				<br />
				<h1 style={{ fontSize: "3em", textAlign: "center" }}>Etc.</h1>
				<br />

				<AboutMe />

			</section>

			<Footer />

		</div>
	);
}

export default Home
