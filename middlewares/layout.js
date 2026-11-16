/**
 * Layouts EJS : la vue est rendue, puis injectée dans le layout via la variable `body`.
 * Choix du layout : option `layout` de res.render, sinon res.locals.layout, sinon le défaut.
 * `layout: false` rend la vue seule.
 */
export function layoutMiddleware(defaultLayout) {
  return (req, res, next) => {
    const render = res.render.bind(res);

    res.render = (view, options = {}, callback) => {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      const layout = options.layout ?? res.locals.layout ?? defaultLayout;
      if (!layout) return render(view, options, callback);

      render(view, options, (error, body) => {
        if (error) return callback ? callback(error) : req.next(error);
        render(layout, { ...options, body }, callback);
      });
    };
    next();
  };
}
