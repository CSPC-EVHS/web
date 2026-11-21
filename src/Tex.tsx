import katex from "katex";
import styled from "styled-components";

const Inline = styled.span`
  display: inline-block;
  vertical-align: middle;
  line-height: 1;
`;

const Block = styled.div`
  overflow-x: auto;
  padding: 10px 12px;
  margin: 10px 0;
  background: #f3eee4;
  border-radius: 8px;

  .katex-display {
    margin: 0;
  }
`;

type TexProps = {
  expr: string;
  block?: boolean;
};

export function Tex({ expr, block = false }: TexProps) {
  if (block) {
    return <Block>{expr}</Block>;
  }
  return <Inline>{expr}</Inline>;
}