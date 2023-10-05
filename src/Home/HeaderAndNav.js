import { useState } from 'react';

function HeaderAndNav() {
    const [menuOpen, setMenuOpen] = useState(false)

    return (
        <>
            <header id="header" className="alt">
                <h1><a href="./">Ashwani Yadav</a></h1>
                <nav>
                    <a className="button" href="https://ashwaniydv.github.io/blog/" target="_blank"><i className="fa fa-newspaper-o" aria-hidden="true"></i>&nbsp;Blog</a>
                    <a className="button" href="#menu" onClick={() => setMenuOpen(true)}>&lt;nav&gt;</a>
                </nav>
            </header>
            <nav id="menu" className={menuOpen && 'menu-open'}>
                <div className="inner">
                    <h2>Menu</h2>
                    <ul className="links">
                        <li><a href="./">Home</a></li>
                        <li><a href="https://ashwaniydv.github.io/blog/">Blog</a></li>
                        <li><a href="https://drive.google.com/file/d/1kv5wctnszrn-0KLncFzsKl2DrmXp8saM/view?usp=sharing" target="_bl">Resume</a></li>
                        <li><a href="#intro" onClick={() => setMenuOpen(false)}>Intro</a></li>
                        <li><a href="#worked" onClick={() => setMenuOpen(false)}>Worked</a></li>
                        <li><a href="#alma-mater" onClick={() => setMenuOpen(false)}>Alma-Mater</a></li>
                        <li><a href="#projects" onClick={() => setMenuOpen(false)}>Projects</a></li>
                    </ul>
                    <a href="#" className="close" onClick={() => setMenuOpen(false)}>Close</a>
                </div>
            </nav>
        </>
    )
}

export default HeaderAndNav