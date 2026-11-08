import { useState } from "react";
import { FORMSPREE_URL, socials } from "../data";

const contactOrder = ["LinkedIn", "GitHub", "Facebook", "Instagram", "Twitter"];

export default function Footer() {
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setSending(true);
    try {
      const res = await fetch(FORMSPREE_URL, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
      });
      if (!res.ok) throw new Error(`Formspree responded ${res.status}`);
      form.reset();
      setStatus("Thanks for connecting!");
    } catch {
      setStatus("Oops! There was a problem.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="footer">
      <div className="inner">
        <h2 className="major">Get in touch</h2>

        <form id="my-form" action={FORMSPREE_URL} method="POST" onSubmit={onSubmit}>
          <p style={{ fontWeight: "bolder" }} id="my-form-status" role="status" aria-live="polite">
            {status}
          </p>
          <div className="field">
            <label htmlFor="emailholder">Email</label>
            <input type="email" name="email" id="emailholder" required />
          </div>
          <div className="field">
            <label htmlFor="messageholder">Message</label>
            <textarea name="message" id="messageholder" rows="4" required />
          </div>
          <ul className="actions">
            <li>
              <button id="my-form-button" type="submit" disabled={sending}>
                Send Message
              </button>
            </li>
          </ul>
        </form>

        <ul className="contact">
          <li>
            <code>IRC: @ashwaniYDV</code>
          </li>
          {contactOrder.map((name) => {
            const s = socials.find((x) => x.name === name);
            return (
              <li key={name}>
                <a target="_blank" rel="noreferrer" href={s.url} className="myfont">
                  &nbsp;&nbsp;&nbsp;{name}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
