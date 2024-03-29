// helper function for sending an AJAX request
function ajax(method, url, data, success, error) {
	var xhr = new XMLHttpRequest();
	xhr.open(method, url);
	xhr.setRequestHeader("Accept", "application/json");
	xhr.onreadystatechange = function () {
		if (xhr.readyState !== XMLHttpRequest.DONE) return;
		if (xhr.status === 200) {
			success(xhr.response, xhr.responseType);
		} else {
			error(xhr.status, xhr.response, xhr.responseType);
		}
	};
	xhr.send(data);
}

function ContactForm() {
    const submitForm = (e) => {
		e.preventDefault()
		// get the form elements defined in your form HTML above

		var form = document.getElementById("my-form");
		var button = document.getElementById("my-form-button");
		var status = document.getElementById("my-form-status");

		// Success and Error functions for after the form is submitted

		function success() {
			form.reset();
			status.innerHTML = "Thanks for connecting!";
		}

		function error() {
			status.innerHTML = "Oops! There was a problem.";
		}

		var data = new FormData(form);
		ajax("POST", "https://formspree.io/mqkygoae", data, success, error);
	}

    return (
        <form id="my-form">
            <p style={{ fontWeight: "bolder" }} id="my-form-status"></p>
            <div className="field">
                <label htmlFor="email">Email</label>
                <input type="email" name="email" id="emailholder" />
            </div>
            <div className="field">
                <label htmlFor="message">Message</label>
                <textarea name="message" id="messageholder" rows="4"></textarea>
            </div>
            <ul className="actions">
                <li><button id="my-form-button" onClick={(e) => submitForm(e)}>Send Message</button></li>
            </ul>
        </form>
    )
}

export default ContactForm