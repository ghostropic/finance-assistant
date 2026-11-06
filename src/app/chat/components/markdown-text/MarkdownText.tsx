import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import styles from "./MarkdownText.module.css"

const REMARK_PLUGINS = [remarkGfm]

const ExternalLink: Components["a"] = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
)

const MARKDOWN_COMPONENTS: Components = { a: ExternalLink }

interface Props {
  text: string
}

/** Renders Claude's markdown. Raw HTML in the text is not rendered (react-markdown's default). */
export const MarkdownText = ({ text }: Props) => (
  <div className={styles.markdown}>
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  </div>
)
