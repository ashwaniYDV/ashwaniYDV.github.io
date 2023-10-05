import { Tilt } from 'react-tilt'

function Banner() {
    const defaultTiltOptions = {
        reverse: false,  // reverse the tilt direction
        max: 30,     // max tilt rotation (degrees)
        perspective: 1000,   // Transform perspective, the lower the more extreme the tilt gets.
        scale: 1.0,    // 2 = 200%, 1.5 = 150%, etc..
        speed: 1000,   // Speed of the enter/exit transition
        transition: true,   // Set a transition on enter/exit.
        axis: null,   // What axis should be disabled. Can be X or Y.
        reset: true,    // If the tilt effect has to be reset on exit.
        easing: "cubic-bezier(.03,.98,.52,.99)",    // Easing on enter/exit.
        glare: true,
        maxGlare: 0.5,
    }

    return (
        <section id="banner" style={{minHeight: "90%"}}>
				<div className="inner">
					
					<div className="logo" style={{display: "flex", justifyContent: "center", alignItems: "center"}}>
						<Tilt options={defaultTiltOptions} >
							<img id="homeimg" />
						</Tilt>
					</div>

					<h2 id="headtext" className="notr myfont" style={{textAlign: "center"}}><b>Ashwani Yadav</b></h2>
					
					<p className="notr myfont" style={{textAlign: "center"}}>
						<span>धर्मो रक्षति रक्षितः</span>
						<br/>
						<a target="_blank" href="https://linkedin.com/in/ashwaniydv" className="fa
							faw-up fa-linkedin"></a>
						<a target="_blank" href="https://www.facebook.com/ashwani.iitp18" className="fa
							faw-up fa-facebook"></a>
						<a target="_blank" href="https://github.com/ashwaniYDV" className="fa faw-up
							fa-github"></a>
						<a target="_blank" href="https://instagram.com/ashwani_fit" className="fa faw-up
							fa-instagram"></a>
						<a target="_blank" href="https://twitter.com/ashwani_iitp" className="fa faw-up
							fa-twitter"></a>
						<br/><a href="https://drive.google.com/file/d/1kv5wctnszrn-0KLncFzsKl2DrmXp8saM/view?usp=sharing" target="_bl" className="button">Resume</a>
						<span id="intro"></span>
					</p>
				</div>
			</section>
    )
}

export default Banner;